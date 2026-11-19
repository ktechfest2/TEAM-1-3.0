import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import { captureSessions, electionParties, elections, parties, reporters, resultVersions, submissions } from '../src/database/schema.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, ORIGIN, removeAdmins, removeElection, removeTestUnits, signInNewAdmin } from './helpers.js';

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`OA${tag}`, `OB${tag}`];

class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  next: [number, number][] = [];
  async read(): Promise<Ec60eReading> {
    const [a, b] = this.next.shift()!;
    return {
      is_ec60e: true, document_description: 'EC60E', image_quality: 'good', stamp_visible: true, signature_present: true,
      election_type_on_form: null, polling_unit_code: null, polling_unit_name: null,
      party_results: [{ party: P[0], votes: a, legible: true }, { party: P[1], votes: b, legible: true }],
      total_valid_votes: a + b, rejected_votes: null, total_votes_cast: null, notes: '',
    };
  }
  async readDeclaration(): Promise<never> {
    throw new Error('not used');
  }
}

describe('Operations console (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let model: FakeVisionModel;
  let electionId: string;
  let reviewer: { cookie: string; email: string };
  let other: { cookie: string; email: string };
  let sysadmin: { cookie: string; email: string };
  const reporterIds: string[] = [];

  const photo = async (votes: [number, number]) => {
    const phone = `0906${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const start = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
    const up = await request(app.getHttpServer())
      .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=24-98-01-001`)
      .set('Authorization', `Bearer ${start.body.token}`)
      .set('X-Device-Id', randomUUID())
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]))
      .expect(201);
    const [row] = await db.select({ reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.id, up.body.id));
    reporterIds.push(row.reporterId);
    model.next.push(votes);
    await app.get(VerificationService).process(up.body.id);
  };
  const get = (path: string, who: { cookie: string }) => request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
  const post = (path: string, who: { cookie: string }, body: object) => request(app.getHttpServer()).post(path).set('Cookie', who.cookie).set('Origin', ORIGIN).send(body);

  beforeAll(async () => {
    model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(VisionModel).useValue(model).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    await addTestUnits(app);
    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({ type: 'local_government', title: 'E2E ops election', electionDate: '2026-11-01', scopeLevel: 'lga', scopeCode: '24-98', pollsCloseAt: new Date('2026-11-01T13:30:00Z'), status: 'active' })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
    [reviewer, other, sysadmin] = [await signInNewAdmin(app, 'reviewer'), await signInNewAdmin(app, 'reviewer'), await signInNewAdmin(app, 'system_admin')];
    // Two witnesses with different figures: disputed
    await photo([60, 40]);
    await photo([40, 60]);
  });

  afterAll(async () => {
    await removeElection(app, electionId);
    await db.delete(captureSessions).where(inArray(captureSessions.reporterId, reporterIds));
    await db.delete(reporters).where(inArray(reporters.id, reporterIds));
    await db.delete(parties).where(inArray(parties.acronym, P));
    await removeAdmins(app, [reviewer.email, other.email, sysadmin.email]);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  it('shows the election-day dashboard', async () => {
    const d = (await get(`/admin/ops/dashboard?electionId=${electionId}`, reviewer).expect(200)).body;
    expect(d.election.title).toBe('E2E ops election');
    expect(d.totals.mix.disputed).toBe(1);
    expect(d.areas.length).toBeGreaterThan(0);
    expect(d.lastHour.reduce((n: number, r: { n: number }) => n + r.n, 0)).toBe(2);
    expect(d.review).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'disputed', assigned: false, n: 1 })]));
    expect(Array.isArray(d.alerts)).toBe(true);
  });

  it('puts disputed units first and lets reviewers claim them', async () => {
    const queue = (await get('/admin/ops/queue', reviewer).expect(200)).body;
    const mine = queue.find((i: { key: string }) => i.key === `${electionId}:24-98-01-001`);
    expect(mine).toMatchObject({ kind: 'unit', priority: 0, assignedTo: null });

    const me = (await get('/admin/auth/me', reviewer).expect(200)).body;
    const them = (await get('/admin/auth/me', other).expect(200)).body;
    await post('/admin/ops/assign', reviewer, { kind: 'unit', key: mine.key, to: them.id }).expect(403); // only for themselves
    await post('/admin/ops/assign', reviewer, { kind: 'unit', key: mine.key, to: me.id }).expect(200);
    await post('/admin/ops/assign', other, { kind: 'unit', key: mine.key, to: null }).expect(403); // not theirs to release
    await post('/admin/ops/assign', sysadmin, { kind: 'unit', key: mine.key, to: them.id }).expect(200);
    const after = (await get('/admin/ops/queue', reviewer).expect(200)).body.find((i: { key: string }) => i.key === mine.key);
    expect(after.assignee).toBe(them.displayName);
  });

  it('counts decisions and turnaround per reviewer', async () => {
    const them = (await get('/admin/auth/me', other).expect(200)).body;
    const [version] = await db.select({ id: resultVersions.id }).from(resultVersions).where(eq(resultVersions.electionId, electionId)).limit(1);
    await post('/admin/review/resolve', other, { electionId, unitCode: '24-98-01-001', versionId: version.id, reason: 'The stamped photo is clearer.' }).expect(200);
    const work = (await get('/admin/ops/workload', sysadmin).expect(200)).body;
    expect(work.find((w: { id: string }) => w.id === them.id)).toMatchObject({ open: 0, decidedToday: 1, medianMinutes: expect.any(Number) });
    const queue = (await get('/admin/ops/queue', reviewer).expect(200)).body;
    expect(queue.find((i: { key: string }) => i.key === `${electionId}:24-98-01-001`)).toBeUndefined();
  });

  it('searches the audit log, for system administrators only', async () => {
    await get('/admin/ops/audit?action=unit.resolved', reviewer).expect(403);
    const res = (await get('/admin/ops/audit?action=unit.resolved', sysadmin).expect(200)).body;
    expect(res.rows[0]).toMatchObject({ action: 'unit.resolved', admin: expect.stringContaining('E2E') });
    const text = (await get('/admin/ops/audit?q=clearer', sysadmin).expect(200)).body;
    expect(text.rows.length).toBeGreaterThan(0);
  });
});
