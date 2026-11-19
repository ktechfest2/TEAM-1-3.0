import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { canonicalJson, entryHashInput, GENESIS_HASH, type ChainEntryType } from '@trustelect/shared';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Database } from '../database/database.module.js';
import { chainAnchors, chainEntries } from '../database/schema.js';
import { declarationRecord, submissionRecord, unitResultRecord, type Executor } from './records.js';

/** Advisory lock that serialises appends, so sequence numbers have no gaps */
const CHAIN_LOCK = 7_303_281;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Append-only hash chain (EVD-02): every photo submission, unit result, declaration and
 * administrative action is written as an entry holding the SHA-256 of its canonical record
 * and the hash of the entry before it. A later change to any record, or to the chain, no
 * longer matches; published anchors (EVD-03) make rewriting the whole chain detectable too.
 */
@Injectable()
export class ChainService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /**
   * Chains the current state of a record. The record is read under the chain lock, so the
   * latest entry for a record is always its latest state. Unchanged records are not re-chained.
   */
  async append(
    entryType: ChainEntryType,
    load: (tx: Executor) => Promise<{ ref: string; record: unknown } | null>,
    exec: Executor = this.db,
  ) {
    return exec.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${CHAIN_LOCK})`);
      const loaded = await load(tx);
      if (!loaded) return null;
      const payload = canonicalJson(loaded.record);
      const payloadSha256 = sha256(payload);

      const [last] = await tx
        .select({ payloadSha256: chainEntries.payloadSha256 })
        .from(chainEntries)
        .where(and(eq(chainEntries.entryType, entryType), eq(chainEntries.refId, loaded.ref)))
        .orderBy(desc(chainEntries.seq))
        .limit(1);
      if (last?.payloadSha256 === payloadSha256) return null;

      const [head] = await tx.select({ seq: chainEntries.seq, hash: chainEntries.hash }).from(chainEntries).orderBy(desc(chainEntries.seq)).limit(1);
      const entry = {
        seq: (head?.seq ?? 0) + 1,
        entryType,
        refId: loaded.ref,
        payloadSha256,
        prevHash: head?.hash ?? GENESIS_HASH,
        createdAt: new Date().toISOString(),
      };
      const hash = sha256(entryHashInput(entry));
      await tx.insert(chainEntries).values({ ...entry, payload, hash, createdAt: new Date(entry.createdAt) });
      return { seq: entry.seq, hash };
    });
  }

  syncSubmission(id: string, exec?: Executor) {
    return this.append('submission', async (tx) => {
      const record = await submissionRecord(tx, id);
      return record && { ref: id, record };
    }, exec);
  }

  syncUnitResult(electionId: string, pollingUnitId: number, exec?: Executor) {
    return this.append('unit_result', (tx) => unitResultRecord(tx, electionId, pollingUnitId), exec);
  }

  syncDeclaration(id: string, exec?: Executor) {
    return this.append('declaration', async (tx) => {
      const record = await declarationRecord(tx, id);
      return record && { ref: id, record };
    }, exec);
  }

  /** ADM-06: administrative actions are chained as they are logged */
  recordAudit(row: { id: number } & Record<string, unknown>, exec?: Executor) {
    return this.append('audit', async () => ({ ref: String(row.id), record: row }), exec);
  }

  async head() {
    const [h] = await this.db
      .select({ seq: chainEntries.seq, hash: chainEntries.hash, createdAt: chainEntries.createdAt })
      .from(chainEntries)
      .orderBy(desc(chainEntries.seq))
      .limit(1);
    return h ?? null;
  }

  /** Public listing: hashes only, never payloads (audit payloads can hold personal data) */
  async entries(from: number, limit: number) {
    const rows = await this.db
      .select({
        seq: chainEntries.seq,
        entryType: chainEntries.entryType,
        refId: chainEntries.refId,
        payloadSha256: chainEntries.payloadSha256,
        prevHash: chainEntries.prevHash,
        hash: chainEntries.hash,
        createdAt: chainEntries.createdAt,
      })
      .from(chainEntries)
      .where(gte(chainEntries.seq, from))
      .orderBy(asc(chainEntries.seq))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** Full entries (with payloads) for records, for evidence packs */
  async history(entryType: ChainEntryType, refs: string[]) {
    if (!refs.length) return [];
    const rows = await this.db
      .select()
      .from(chainEntries)
      .where(and(eq(chainEntries.entryType, entryType), inArray(chainEntries.refId, refs)))
      .orderBy(asc(chainEntries.seq));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * Full check of the chain (operators): every entry's payload hash, own hash and link to the
   * one before, every anchor, and that each record still stored equals its latest chained state.
   */
  async verifyAll(onProgress?: (seq: number) => void) {
    const problems: string[] = [];
    const latest = new Map<string, { seq: number; payloadSha256: string; entryType: string; refId: string }>();
    const hashes = new Map<number, string>();
    let prev = GENESIS_HASH;
    let expected = 1;
    for (;;) {
      const page = await this.db.select().from(chainEntries).where(gte(chainEntries.seq, expected)).orderBy(asc(chainEntries.seq)).limit(5000);
      for (const e of page) {
        const createdAt = e.createdAt.toISOString();
        if (e.seq !== expected) problems.push(`entry ${expected} is missing`);
        if (sha256(e.payload) !== e.payloadSha256) problems.push(`entry ${e.seq}: payload does not match its hash`);
        if (sha256(entryHashInput({ ...e, entryType: e.entryType as ChainEntryType, createdAt })) !== e.hash) problems.push(`entry ${e.seq}: hash is wrong`);
        if (e.prevHash !== prev) problems.push(`entry ${e.seq}: does not link to entry ${e.seq - 1}`);
        prev = e.hash;
        expected = e.seq + 1;
        hashes.set(e.seq, e.hash);
        if (e.entryType !== 'audit') latest.set(`${e.entryType}:${e.refId}`, e);
      }
      onProgress?.(expected - 1);
      if (page.length < 5000) break;
    }
    for (const a of await this.db.select().from(chainAnchors)) {
      if (hashes.get(a.seq) !== a.hash) problems.push(`anchor at entry ${a.seq} does not match the chain`);
    }

    let checked = 0;
    let gone = 0;
    for (const e of latest.values()) {
      let current: unknown = null;
      if (e.entryType === 'submission') current = await submissionRecord(this.db, e.refId);
      else if (e.entryType === 'declaration') current = await declarationRecord(this.db, e.refId);
      else if (e.entryType === 'unit_result') {
        const [electionId, unitCode] = e.refId.split(':');
        const [unit] = await this.db.execute<{ id: number }>(sql`select id from polling_units where code = ${unitCode}`).then((r) => r.rows);
        current = unit ? (await unitResultRecord(this.db, electionId, unit.id))?.record ?? null : null;
      }
      if (current === null) {
        gone++;
        continue;
      }
      checked++;
      if (sha256(canonicalJson(current)) !== e.payloadSha256) problems.push(`${e.entryType} ${e.refId}: stored record differs from its chained state`);
    }
    return { entries: expected - 1, head: prev, recordsChecked: checked, recordsNoLongerStored: gone, problems };
  }

  async anchors(limit = 50) {
    const rows = await this.db
      .select({ id: chainAnchors.id, seq: chainAnchors.seq, hash: chainAnchors.hash, createdAt: chainAnchors.createdAt, externalProvider: chainAnchors.externalProvider })
      .from(chainAnchors)
      .orderBy(desc(chainAnchors.seq))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}
