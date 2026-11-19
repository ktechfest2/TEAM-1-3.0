import { BadRequestException, Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { desc, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { apiClients } from '../database/schema.js';

export const registerSchema = z.object({
  organisation: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  website: z.url({ protocol: /^https?$/ }).max(300).nullish(),
  purpose: z.string().trim().min(20, 'Tell us in at least 20 characters how you will use the data').max(1000),
  acceptTerms: z.literal(true, 'Accept the terms of use to register'),
});
export type Registration = z.infer<typeof registerSchema>;

export type ApiClientStatus = 'pending' | 'active' | 'revoked' | 'rejected';
type Known = { id: string; status: ApiClientStatus };

const KEY_PREFIX = 'te_live_';
/** How long a key lookup is remembered (approvals and revocations in this process apply at once) */
const CACHE_MS = 60_000;
const FLUSH_MS = 30_000;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** API keys for outside organisations: registration, approval by an administrator, use. */
@Injectable()
export class ApiKeysService implements OnModuleDestroy {
  /** Outside callers need an active key for public data (PUBLIC_API_KEYS=required) */
  required: boolean;
  private readonly cache = new Map<string, { at: number; client: Known | null }>();
  private readonly usage = new Map<string, number>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.required = config.get('PUBLIC_API_KEYS', { infer: true }) === 'required';
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flush();
  }

  /** Creates a pending client. The key is returned once and never stored. */
  async register(input: Registration) {
    const key = KEY_PREFIX + randomBytes(32).toString('base64url');
    const [client] = await this.db
      .insert(apiClients)
      .values({
        organisation: input.organisation,
        contactName: input.contactName,
        email: input.email.toLowerCase(),
        website: input.website ?? null,
        purpose: input.purpose,
        keyPrefix: key.slice(0, KEY_PREFIX.length + 6),
        keyHash: hashKey(key),
      })
      .returning({ id: apiClients.id, keyPrefix: apiClients.keyPrefix, status: apiClients.status });
    await this.audit.record({ action: 'api_client.registered', targetType: 'api_client', targetId: client.id, details: { organisation: input.organisation } });
    return { ...client, key };
  }

  /** The client a key belongs to, or null for an unknown key */
  async lookup(key: string): Promise<Known | null> {
    if (!key.startsWith(KEY_PREFIX) || key.length > 100) return null;
    const hash = hashKey(key);
    const hit = this.cache.get(hash);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.client;
    const [row] = await this.db.select({ id: apiClients.id, status: apiClients.status }).from(apiClients).where(eq(apiClients.keyHash, hash)).limit(1);
    const client = row ?? null;
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(hash, { at: Date.now(), client });
    return client;
  }

  /** Counted in memory and written every 30 seconds, so busy integrations cost no extra queries */
  recordUse(clientId: string) {
    this.usage.set(clientId, (this.usage.get(clientId) ?? 0) + 1);
  }

  async flush() {
    const pending = [...this.usage];
    this.usage.clear();
    for (const [id, n] of pending) {
      await this.db
        .update(apiClients)
        .set({ requestCount: sql`${apiClients.requestCount} + ${n}`, lastUsedAt: new Date() })
        .where(eq(apiClients.id, id))
        .catch(() => undefined);
    }
  }

  list() {
    return this.db
      .select({
        id: apiClients.id,
        organisation: apiClients.organisation,
        contactName: apiClients.contactName,
        email: apiClients.email,
        website: apiClients.website,
        purpose: apiClients.purpose,
        keyPrefix: apiClients.keyPrefix,
        status: apiClients.status,
        decidedAt: apiClients.decidedAt,
        decisionNote: apiClients.decisionNote,
        lastUsedAt: apiClients.lastUsedAt,
        requestCount: apiClients.requestCount,
        createdAt: apiClients.createdAt,
      })
      .from(apiClients)
      .orderBy(desc(apiClients.createdAt));
  }

  /** approve: pending → active · reject: pending → rejected · revoke: active → revoked */
  async decide(id: string, action: 'approve' | 'reject' | 'revoke', adminId: string, note?: string | null) {
    const [client] = await this.db.select({ status: apiClients.status }).from(apiClients).where(eq(apiClients.id, id)).limit(1);
    if (!client) throw new NotFoundException('Registration not found');
    const from: ApiClientStatus = action === 'revoke' ? 'active' : 'pending';
    if (client.status !== from) throw new BadRequestException(`Only ${from} keys can be ${action === 'approve' ? 'approved' : `${action}ed`}`);
    const to: ApiClientStatus = action === 'approve' ? 'active' : action === 'reject' ? 'rejected' : 'revoked';
    await this.db.update(apiClients).set({ status: to, decidedBy: adminId, decidedAt: new Date(), decisionNote: note ?? null }).where(eq(apiClients.id, id));
    await this.audit.record({ adminUserId: adminId, action: `api_client.${to}`, targetType: 'api_client', targetId: id, details: note ? { note } : undefined });
    this.cache.clear();
    return { id, status: to };
  }
}
