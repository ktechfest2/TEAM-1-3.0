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
import { auditLog, captureSessions, declarations, electionParties, elections, parties, reporters, submissions } from '../src/database/schema.js';
import type { DeclarationReading, Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, ORIGIN, removeAdmins, removeElection, removeTestUnits, signInNewAdmin } from './helpers.js';

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`DA${tag}`, `DB${tag}`];

class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  next: Ec60eReading[] = [];
  declaration: DeclarationReading | null = null;
  async read(): Promise<Ec60eReading> {
    return this.next.shift()!;
  }
  async readDeclaration(): Promise<DeclarationReading> {
    return this.declaration!;
  }
}

const poster = (a: number, b: number, stamp = true): Ec60eReading => ({
  is_ec60e: true,
  document_description: 'EC60E poster',
  image_quality: 'good',
  stamp_visible: stamp,
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

describe('Declared results and comparison (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let model: FakeVisionModel;
  let electionId: string;
  let entrant: { cookie: string; email: string };
  let approver: { cookie: string; email: string };
  let sysadmin: { cookie: string; email: string };
  let reviewer: { cookie: string; email: string };
  const reporterIds: string[] = [];

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
      .values({
        type: 'local_government',
        title: 'E2E declarations election',
        electionDate: '2026-11-01',
        scopeLevel: 'lga',
        scopeCode: '24-98',
        pollsCloseAt: new Date('2026-11-01T13:30:00Z'),
        status: 'active',
      })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
    [entrant, approver, sysadmin, reviewer] = [
      await signInNewAdmin(app, 'declarations_admin'),
      await signInNewAdmin(app, 'approver'),
      await signInNewAdmin(app, 'system_admin'),
      await signInNewAdmin(app, 'reviewer'),
    ];

    // Citizen results: unit 1 has two stamped witnesses, unit 2 one witness without a stamp (low)
    const verification = app.get(VerificationService);
    const photo = async (unit: string, reading: Ec60eReading) => {
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
      const [row] = await db.select({ reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.id, up.body.id));
      reporterIds.push(row.reporterId);
      model.next.push(reading);
      await verification.process(up.body.id);
    };
    await photo('24-98-01-001', poster(100, 50));
    await photo('24-98-01-001', poster(100, 50));
    await photo('24-98-01-002', poster(30, 70, false));
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
    await removeAdmins(app, [entrant.email, approver.email, sysadmin.email, reviewer.email]);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  const post = (path: string, who: { cookie: string }) => request(app.getHttpServer()).post(path).set('Cookie', who.cookie).set('Origin', ORIGIN);
  const tally = async (query = '') => (await request(app.getHttpServer()).get(`/results/elections/${electionId}${query}`).expect(200)).body;
  const base = {
    level: 'lga',
    areaCode: '24-98',
    declaredAt: '2026-11-02T10:00:00+01:00',
    sourceKind: 'inec_statement',
    sourceUrl: 'https://inecnigeria.org/example-statement',
  };

  it('prefills figures from a photo of the source document', async () => {
    model.declaration = {
      is_result_document: true,
      document_type: 'EC8C',
      document_description: 'LGA collation result',
      area_name: 'TEST LGA',
      image_quality: 'good',
      party_results: [
        { party: P[0].toLowerCase(), votes: 120, legible: true },
        { party: P[1], votes: 200, legible: true },
        { party: 'OTHER', votes: 5, legible: true },
      ],
      total_valid_votes: 320,
      rejected_votes: 7,
      total_votes_cast: 327,
      notes: '',
    };
    const res = await post(`/admin/declarations/source?electionId=${electionId}`, entrant).set('Content-Type', 'image/jpeg').send(jpeg()).expect(200);
    expect(res.body.sourceFileKey).toMatch(/\.jpg$/);
    expect(res.body.prefill).toMatchObject({ partyVotes: { [P[0]]: 120, [P[1]]: 200 }, totalValid: 320, unmatchedParties: ['OTHER'] });
  });

  it('validates declarations', async () => {
    const votes = { [P[0]]: 120, [P[1]]: 200 };
    await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: { [P[0]]: 120 } }).expect(400);
    await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: votes, areaCode: '19-98' }).expect(400);
    await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: votes, level: 'state', areaCode: '24' }).expect(400);
    await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: votes, totalValid: 999 }).expect(400);
    await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: votes, sourceUrl: undefined }).expect(400);
    await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: votes, declaredAt: '2099-01-01T00:00:00Z' }).expect(400);
    await post('/admin/declarations', reviewer).send({ ...base, electionId, partyVotes: votes }).expect(403);
  });

  it('needs a second administrator to approve, and only approved declarations are compared', async () => {
    const created = await post('/admin/declarations', entrant).send({ ...base, electionId, partyVotes: { [P[0]]: 120, [P[1]]: 200 }, totalValid: 320 }).expect(201);
    expect(created.body.status).toBe('pending');
    expect((await tally()).totals.comparison.status).toBe('awaiting_data');

    // Someone entering and approving their own declaration is refused, whatever their role
    const own = await post('/admin/declarations', sysadmin).send({ ...base, electionId, partyVotes: { [P[0]]: 120, [P[1]]: 200 } }).expect(201);
    await post(`/admin/declarations/${own.body.id}/approve`, sysadmin).expect(403);
    await post(`/admin/declarations/${own.body.id}/reject`, approver).send({ reason: 'Duplicate of the statement entered earlier.' }).expect(200);

    await post(`/admin/declarations/${created.body.id}/approve`, entrant).expect(403); // wrong role
    const approved = await post(`/admin/declarations/${created.body.id}/approve`, approver).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: expect.stringContaining('E2E') });
    await post(`/admin/declarations/${created.body.id}/approve`, approver).expect(409);
  });

  it('calls a difference that rests only on a low-confidence unit a possible mismatch', async () => {
    // Citizen: P0 130 (100 stamped + 30 unstamped) > 120 declared; without the low unit, 100 <= 120
    const c = (await tally()).totals.comparison;
    expect(c.status).toBe('possible_mismatch_low_confidence');
    expect(c.parties.find((p: { party: string }) => p.party === P[0])).toMatchObject({ declared: 120, citizen: 130, exceedsDeclared: true });
  });

  it('does not match when stamped citizen votes exceed a ward declaration; wards without one await data', async () => {
    const ward = await post('/admin/declarations', entrant)
      .send({ ...base, electionId, level: 'ward', areaCode: '24-98-01', partyVotes: { [P[0]]: 90, [P[1]]: 60 }, totalValid: 150 })
      .expect(201);
    await post(`/admin/declarations/${ward.body.id}/approve`, approver).expect(200);
    const lga = await tally();
    const ward1 = lga.children.find((c: { code: string }) => c.code === '24-98-01');
    const ward2 = lga.children.find((c: { code: string }) => c.code === '24-98-02');
    expect(ward1.comparison.status).toBe('does_not_match');
    expect(ward1.comparison.reasons.join(' ')).toMatch(/more than the 90 declared/);
    expect(ward2.comparison.status).toBe('awaiting_data');
  });

  it('pauses the comparison when two approved declarations for the same area disagree', async () => {
    const second = await post('/admin/declarations', entrant)
      .send({ ...base, electionId, partyVotes: { [P[0]]: 121, [P[1]]: 200 }, sourceKind: 'broadcast', sourceUrl: 'https://example.org/broadcast' })
      .expect(201);
    await post(`/admin/declarations/${second.body.id}/approve`, approver).expect(200);
    expect((await tally()).totals.comparison.status).toBe('conflicting_declarations');
  });

  it('lists declarations for administrators with who entered and approved them', async () => {
    const res = await request(app.getHttpServer()).get(`/admin/declarations?electionId=${electionId}`).set('Cookie', reviewer.cookie).expect(200);
    expect(res.body.length).toBe(4);
    expect(res.body.every((d: { areaName: string }) => d.areaName)).toBe(true);
    const rejected = res.body.find((d: { status: string }) => d.status === 'rejected');
    expect(rejected.rejectionReason).toMatch(/Duplicate/);
  });
});
