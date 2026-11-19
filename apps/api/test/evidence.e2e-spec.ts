import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { verifyPack, type ChainEntry, type PublishedChain } from '@trustelect/shared';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AnchorService } from '../src/chain/anchor.service.js';
import type { Database } from '../src/database/database.module.js';
import {
  auditLog,
  captureSessions,
  chainEntries,
  declarations,
  electionParties,
  elections,
  parties,
  pollingUnits,
  reporters,
  submissions,
  unitResults,
} from '../src/database/schema.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, ORIGIN, removeAdmins, removeElection, removeTestUnits, signInNewAdmin } from './helpers.js';

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`EA${tag}`, `EB${tag}`];

class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  next: Ec60eReading[] = [];
  async read(): Promise<Ec60eReading> {
    return this.next.shift()!;
  }
  async readDeclaration(): Promise<never> {
    throw new Error('not used');
  }
}

const poster = (a: number, b: number): Ec60eReading => ({
  is_ec60e: true,
  document_description: 'EC60E poster',
  image_quality: 'good',
  stamp_visible: true,
  signature_present: true,
  election_type_on_form: null,
  polling_unit_code: null,
  polling_unit_name: null,
  party_results: [
    { party: P[0], votes: a, legible: true },
    { party: P[1], votes: b, legible: true },
  ],
  total_valid_votes: a + b,
  rejected_votes: null,
  total_votes_cast: null,
  notes: '',
});

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Hash chain and evidence packs (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let model: FakeVisionModel;
  let electionId: string;
  let entrant: { cookie: string; email: string };
  let approver: { cookie: string; email: string };
  let firstSeq: number;
  const reporterIds: string[] = [];
  const submissionIds: string[] = [];

  const published: PublishedChain = {
    async entries(from) {
      const all: ChainEntry[] = [];
      for (;;) {
        const page = (await request(app.getHttpServer()).get(`/chain/entries?from=${from}&limit=5000`).expect(200)).body as ChainEntry[];
        all.push(...page);
        if (page.length < 5000) return all;
        from = page.at(-1)!.seq + 1;
      }
    },
    async anchors() {
      return (await request(app.getHttpServer()).get('/chain/anchors?limit=500').expect(200)).body;
    },
  };
  const pack = async (path: string) =>
    (await request(app.getHttpServer()).get(`/evidence/elections/${electionId}/${path}`).buffer(true).parse(binary).expect(200)).body as Buffer;
  const check = async (path: string) => verifyPack(new Uint8Array(await pack(path)), published);
  const failed = (r: Awaited<ReturnType<typeof check>>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.title);

  beforeAll(async () => {
    model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(VisionModel).useValue(model).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    await addTestUnits(app);
    const [{ seq }] = await db.execute<{ seq: number }>(sql`select coalesce(max(seq), 0)::int + 1 as seq from chain_entries`).then((r) => r.rows);
    firstSeq = seq;

    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({
        type: 'local_government',
        title: 'E2E evidence election',
        electionDate: '2026-11-01',
        scopeLevel: 'lga',
        scopeCode: '24-98',
        pollsCloseAt: new Date('2026-11-01T13:30:00Z'),
        status: 'active',
      })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
    [entrant, approver] = [await signInNewAdmin(app, 'declarations_admin'), await signInNewAdmin(app, 'approver')];

    const verification = app.get(VerificationService);
    for (const [unit, reading] of [
      ['24-98-01-001', poster(100, 50)],
      ['24-98-01-001', poster(100, 50)],
      ['24-98-01-002', poster(30, 70)],
    ] as const) {
      const phone = `0909${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      const start = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
      const cookie = ([] as string[]).concat(start.headers['set-cookie'] ?? [])[0].split(';')[0];
      const up = await request(app.getHttpServer())
        .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=${unit}`)
        .set('Cookie', cookie)
        .set('X-Device-Id', randomUUID())
        .set('Content-Type', 'image/jpeg')
        .send(jpeg())
        .expect(201);
      submissionIds.push(up.body.id);
      const [row] = await db.select({ reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.id, up.body.id));
      reporterIds.push(row.reporterId);
      model.next.push(reading);
      await verification.process(up.body.id);
    }

    const ward = await request(app.getHttpServer())
      .post('/admin/declarations')
      .set('Cookie', entrant.cookie)
      .set('Origin', ORIGIN)
      .send({
        electionId,
        level: 'ward',
        areaCode: '24-98-01',
        partyVotes: { [P[0]]: 130, [P[1]]: 120 },
        declaredAt: '2026-11-02T10:00:00+01:00',
        sourceKind: 'inec_statement',
        sourceUrl: 'https://inecnigeria.org/example',
      })
      .expect(201);
    await request(app.getHttpServer()).post(`/admin/declarations/${ward.body.id}/approve`).set('Cookie', approver.cookie).set('Origin', ORIGIN).expect(200);
  });

  afterAll(async () => {
    const ids = (await db.select({ id: declarations.id }).from(declarations).where(eq(declarations.electionId, electionId))).map((d) => d.id);
    if (ids.length) await db.delete(auditLog).where(inArray(auditLog.targetId, ids));
    await db.delete(declarations).where(eq(declarations.electionId, electionId));
    await removeElection(app, electionId);
    if (reporterIds.length) {
      await db.delete(captureSessions).where(inArray(captureSessions.reporterId, reporterIds));
      await db.delete(reporters).where(inArray(reporters.id, reporterIds));
    }
    await db.delete(parties).where(inArray(parties.acronym, P));
    await removeAdmins(app, [entrant.email, approver.email]);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  it('chains every photo, unit result, declaration and admin action, each linked to the one before', async () => {
    const entries = await published.entries(firstSeq);
    const types = new Set(entries.map((e) => e.entryType));
    expect([...types]).toEqual(expect.arrayContaining(['submission', 'unit_result', 'declaration', 'audit']));
    for (const id of submissionIds) {
      // Received (pending) and then verified
      expect(entries.filter((e) => e.refId === id).length).toBeGreaterThanOrEqual(2);
    }
    // The public listing never carries record contents
    expect(entries.every((e) => !('payload' in e))).toBe(true);
    const r = await check('units/24-98-01-001');
    expect(failed(r)).toEqual([]);
  });

  it('refuses to change or delete chain entries', async () => {
    await expect(db.execute(sql`update chain_entries set ref_id = 'x' where seq = ${firstSeq}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from chain_entries where seq = ${firstSeq}`)).rejects.toThrow();
  });

  it('publishes anchors of the latest hash', async () => {
    const anchor = await app.get(AnchorService).publish();
    expect(anchor).toMatchObject({ seq: expect.any(Number), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await app.get(AnchorService).publish()).toBeNull(); // nothing new to anchor
    const head = (await request(app.getHttpServer()).get('/chain/head').expect(200)).body;
    expect(head.latestAnchor.seq).toBe(head.head.seq);
    const text = await request(app.getHttpServer()).get(`/chain/anchors/${anchor!.id}/record.txt`).expect(200);
    expect(text.text).toContain(`hash: ${anchor!.hash}`);
  });

  it('builds unit and ward packs that pass the public check', async () => {
    const unit = await check('units/24-98-01-001');
    expect(unit.ok).toBe(true);
    expect(unit.checks.find((c) => c.title === 'Matches published anchors')?.status).toBe('pass');
    expect(Object.keys(unit.manifest!.photos)).toHaveLength(2);
    // No personal data in the published records
    expect(JSON.stringify(unit.manifest)).not.toMatch(/reporter|deviceHash|ipHash|latitude|phone/i);

    const ward = await check('wards/24-98-01');
    expect(ward.ok).toBe(true);
    expect(ward.manifest!.records.map((r) => r.entryType)).toEqual(expect.arrayContaining(['unit_result', 'submission', 'declaration']));
    expect(Object.keys(ward.manifest!.photos)).toHaveLength(3);
    await request(app.getHttpServer()).get(`/evidence/elections/${electionId}/units/24-98-02-001`).expect(200);
    await request(app.getHttpServer()).get(`/evidence/elections/${randomUUID()}/units/24-98-01-001`).expect(404);
  });

  it('fails when a stored unit result is changed', async () => {
    const [u] = await db.select({ id: pollingUnits.id }).from(pollingUnits).where(eq(pollingUnits.code, '24-98-01-001'));
    const where = and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, u.id));
    await db.update(unitResults).set({ witnessCount: 9 }).where(where);
    try {
      expect(failed(await check('units/24-98-01-001'))).toContain('Stored record unchanged');
    } finally {
      await db.update(unitResults).set({ witnessCount: 2 }).where(where);
    }
    expect((await check('units/24-98-01-001')).ok).toBe(true);
  });

  it("fails when a submission's figures are changed", async () => {
    const [s] = await db.select({ extracted: submissions.extracted }).from(submissions).where(eq(submissions.id, submissionIds[0]));
    await db.update(submissions).set({ extracted: { ...s.extracted!, partyVotes: { [P[0]]: 150, [P[1]]: 0 } } }).where(eq(submissions.id, submissionIds[0]));
    try {
      expect(failed(await check('units/24-98-01-001'))).toContain('Stored record unchanged');
    } finally {
      await db.update(submissions).set({ extracted: s.extracted }).where(eq(submissions.id, submissionIds[0]));
    }
  });

  it('fails when a photograph is replaced or removed', async () => {
    const [s] = await db.select({ imageKey: submissions.imageKey }).from(submissions).where(eq(submissions.id, submissionIds[0]));
    const path = join(resolve(process.env.EVIDENCE_DIR!), s.imageKey!);
    const original = await readFile(path);
    await chmod(path, 0o640);
    try {
      await writeFile(path, jpeg());
      expect(failed(await check('units/24-98-01-001'))).toContain('Photograph unchanged');
      await rm(path);
      expect(failed(await check('units/24-98-01-001'))).toContain('Accepted photographs present');
    } finally {
      await writeFile(path, original, { mode: 0o440 });
    }
    expect((await check('units/24-98-01-001')).ok).toBe(true);
  });

  it('fails when the chain itself is rewritten, even consistently', async () => {
    const [entry] = await db
      .select()
      .from(chainEntries)
      .where(and(eq(chainEntries.entryType, 'unit_result'), eq(chainEntries.refId, `${electionId}:24-98-01-001`)))
      .orderBy(chainEntries.seq)
      .limit(1);
    const { createHash } = await import('node:crypto');
    const { entryHashInput } = await import('@trustelect/shared');
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const payload = entry.payload.replace('"witnessCount":1', '"witnessCount":5');
    expect(payload).not.toBe(entry.payload);
    const payloadSha256 = sha(payload);
    const hash = sha(entryHashInput({ ...entry, entryType: 'unit_result', payloadSha256, createdAt: entry.createdAt.toISOString() }));
    await db.execute(sql`alter table chain_entries disable trigger chain_entries_append_only`);
    try {
      await db.update(chainEntries).set({ payload, payloadSha256, hash }).where(eq(chainEntries.seq, entry.seq));
      const r = await check('units/24-98-01-001');
      expect(r.ok).toBe(false);
      expect(failed(r)).toContain('Published chain is unbroken');
    } finally {
      await db.update(chainEntries).set({ payload: entry.payload, payloadSha256: entry.payloadSha256, hash: entry.hash }).where(eq(chainEntries.seq, entry.seq));
      await db.execute(sql`alter table chain_entries enable trigger chain_entries_append_only`);
    }
    expect((await check('units/24-98-01-001')).ok).toBe(true);
  });
});
