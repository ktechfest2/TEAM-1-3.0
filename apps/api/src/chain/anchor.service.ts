import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { anchorRecordText } from '@trustelect/shared';
import { desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { chainAnchors } from '../database/schema.js';
import { ChainService } from './chain.service.js';

const OTS_CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org'];
/** Magic bytes of a detached OpenTimestamps proof file */
const OTS_HEADER = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');

/**
 * Builds a standard .ots file for a SHA-256 digest from a calendar's reply, so anyone can
 * check the anchor record with the OpenTimestamps tools (`ots verify anchor.txt.ots`).
 */
export function otsProofFile(digest: Buffer, calendarReply: Buffer): Buffer {
  return Buffer.concat([OTS_HEADER, Buffer.from([0x01, 0x08]), digest, calendarReply]);
}

/** Publishes the latest chain hash at regular intervals (EVD-03). */
@Injectable()
export class AnchorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ChainAnchors');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly chain: ChainService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('CHAIN_ANCHOR_WORKER', { infer: true }) !== 'on') return;
    const minutes = this.config.get('CHAIN_ANCHOR_MINUTES', { infer: true });
    this.timer = setInterval(() => void this.publish().catch((err: Error) => this.logger.error(err.message)), minutes * 60_000);
    // Anchor shortly after start too, so a restart never leaves the head unpublished for long
    setTimeout(() => void this.publish().catch((err: Error) => this.logger.error(err.message)), 5_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Records an anchor for the current head if the chain has grown since the last one. */
  async publish(fetchImpl: typeof fetch = fetch) {
    const head = await this.chain.head();
    if (!head) return null;
    const [last] = await this.db.select({ seq: chainAnchors.seq }).from(chainAnchors).orderBy(desc(chainAnchors.seq)).limit(1);
    if (last && last.seq >= head.seq) return null;

    const anchor = { seq: head.seq, hash: head.hash, createdAt: new Date() };
    let externalProvider: string | null = null;
    let externalProof: string | null = null;
    if (this.config.get('CHAIN_ANCHOR_EXTERNAL', { infer: true }) === 'opentimestamps') {
      const digest = createHash('sha256')
        .update(anchorRecordText({ ...anchor, createdAt: anchor.createdAt.toISOString() }))
        .digest();
      for (const calendar of OTS_CALENDARS) {
        try {
          const res = await fetchImpl(`${calendar}/digest`, {
            method: 'POST',
            headers: { Accept: 'application/vnd.opentimestamps.v1', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'trustelect-anchor' },
            body: digest,
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          externalProof = otsProofFile(digest, Buffer.from(await res.arrayBuffer())).toString('base64');
          externalProvider = 'opentimestamps';
          break;
        } catch (err) {
          this.logger.warn(`OpenTimestamps calendar ${calendar} failed: ${(err as Error).message}`);
        }
      }
    }
    const [row] = await this.db
      .insert(chainAnchors)
      .values({ ...anchor, externalProvider, externalProof })
      .onConflictDoNothing()
      .returning({ id: chainAnchors.id });
    if (row) this.logger.log(`anchor published at entry ${anchor.seq}${externalProvider ? ` (${externalProvider})` : ''}`);
    return row ? { id: row.id, ...anchor } : null;
  }

  async proof(id: number) {
    const [a] = await this.db.select().from(chainAnchors).where(eq(chainAnchors.id, id)).limit(1);
    return a ?? null;
  }
}
