import { ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { Database } from '../database/database.module.js';
import { adminUsers, knowledgeEntries } from '../database/schema.js';
import { KNOWLEDGE } from '../whatsapp/knowledge.js';

/** INF-07: links must point to an official source */
const OFFICIAL_HOSTS = [/(^|\.)inecnigeria\.org$/, /(^|\.)inecelectionresults\.ng$/, /(^|\.)gov\.ng$/, /^trustelect\.web\.app$/];

export const knowledgeInputSchema = z.object({
  topic: z.string().trim().min(3).max(80),
  fact: z.string().trim().min(20).max(800),
  sourceName: z.string().trim().min(3).max(160),
  sourceUrl: z
    .url({ protocol: /^https$/ })
    .refine((u) => OFFICIAL_HOSTS.some((h) => h.test(new URL(u).hostname)), {
      message: 'Use an official source: inecnigeria.org, inecelectionresults.ng, a .gov.ng site or trustelect.web.app',
    })
    .nullish(),
});
export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;
export type Fact = { topic: string; fact: string; source: string };

const CACHE_MS = 60_000;

/** The assistant's knowledge base (ADM-04, INF-07), managed by administrators with a two-person rule. */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private cache: { at: number; facts: Fact[] } | null = null;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** First start: the initial facts become the approved set, so the assistant works from day one */
  async onModuleInit() {
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(knowledgeEntries);
    if (n > 0) return;
    await this.db.insert(knowledgeEntries).values(
      KNOWLEDGE.map((k) => ({ topic: k.topic, fact: k.fact, sourceName: k.source, status: 'approved' as const, approvedAt: new Date() })),
    );
  }

  /** Approved facts, as the assistant sees them */
  async approvedFacts(): Promise<Fact[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.facts;
    const rows = await this.db
      .select({ topic: knowledgeEntries.topic, fact: knowledgeEntries.fact, sourceName: knowledgeEntries.sourceName, sourceUrl: knowledgeEntries.sourceUrl })
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.status, 'approved'))
      .orderBy(asc(knowledgeEntries.topic));
    const facts = rows.map((r) => ({ topic: r.topic, fact: r.fact, source: r.sourceUrl ? `${r.sourceName}, ${r.sourceUrl}` : r.sourceName }));
    this.cache = { at: Date.now(), facts };
    return facts;
  }

  async list() {
    const entrant = alias(adminUsers, 'entrant');
    const approver = alias(adminUsers, 'approver');
    return this.db
      .select({
        id: knowledgeEntries.id,
        topic: knowledgeEntries.topic,
        fact: knowledgeEntries.fact,
        sourceName: knowledgeEntries.sourceName,
        sourceUrl: knowledgeEntries.sourceUrl,
        status: knowledgeEntries.status,
        enteredById: knowledgeEntries.enteredBy,
        enteredBy: entrant.displayName,
        approvedBy: approver.displayName,
        approvedAt: knowledgeEntries.approvedAt,
        updatedAt: knowledgeEntries.updatedAt,
      })
      .from(knowledgeEntries)
      .leftJoin(entrant, eq(entrant.id, knowledgeEntries.enteredBy))
      .leftJoin(approver, eq(approver.id, knowledgeEntries.approvedBy))
      .orderBy(asc(knowledgeEntries.status), asc(knowledgeEntries.topic));
  }

  async create(input: KnowledgeInput, adminId: string) {
    const [row] = await this.db
      .insert(knowledgeEntries)
      .values({ ...input, sourceUrl: input.sourceUrl ?? null, enteredBy: adminId })
      .returning();
    await this.audit.record({ adminUserId: adminId, action: 'knowledge.entered', targetType: 'knowledge', targetId: row.id, details: { ...input } });
    return row;
  }

  /** An edited fact goes back to pending until a second administrator approves it */
  async update(id: string, input: KnowledgeInput, adminId: string) {
    await this.get(id);
    const [row] = await this.db
      .update(knowledgeEntries)
      .set({ ...input, sourceUrl: input.sourceUrl ?? null, status: 'pending', enteredBy: adminId, approvedBy: null, approvedAt: null, updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    this.cache = null;
    await this.audit.record({ adminUserId: adminId, action: 'knowledge.edited', targetType: 'knowledge', targetId: id, details: { ...input } });
    return row;
  }

  async approve(id: string, adminId: string) {
    const entry = await this.get(id);
    if (entry.status !== 'pending') throw new ConflictException(`This fact is already ${entry.status}`);
    if (entry.enteredBy === adminId) throw new ForbiddenException('A second administrator must approve a fact you entered');
    const [row] = await this.db
      .update(knowledgeEntries)
      .set({ status: 'approved', approvedBy: adminId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    this.cache = null;
    await this.audit.record({ adminUserId: adminId, action: 'knowledge.approved', targetType: 'knowledge', targetId: id });
    return row;
  }

  /** Stops the assistant using a fact (kept for the record) */
  async retire(id: string, adminId: string) {
    await this.get(id);
    const [row] = await this.db
      .update(knowledgeEntries)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(knowledgeEntries.id, id))
      .returning();
    this.cache = null;
    await this.audit.record({ adminUserId: adminId, action: 'knowledge.retired', targetType: 'knowledge', targetId: id });
    return row;
  }

  private async get(id: string) {
    const [row] = await this.db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, id)).limit(1);
    if (!row) throw new NotFoundException('Fact not found');
    return row;
  }
}
