import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import {
  auditLog,
  captureSessions,
  electionParties,
  elections,
  parties,
  rejectionLog,
  reporters,
  resultVersions,
  submissions,
  unitResults,
} from '../src/database/schema.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, ORIGIN, removeAdmins, removeElection, removeTestUnits, signInNewAdmin, TEST_UNIT } from './helpers.js';

class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  async readDeclaration(): Promise<never> {
    throw new Error('not used');
  }
  next: Ec60eReading[] = [];
  async read(): Promise<Ec60eReading> {
    return this.next.shift()!;
  }
}

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`WA${tag}`, `WB${tag}`];

const poster = (a: number, b: number, stamp = true): Ec60eReading => ({
  is_ec60e: true,
  document_description: 'EC60E poster',
  image_quality: 'good',
  stamp_visible: stamp,
  signature_present: true,
  election_type_on_form: 'Governorship',
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

describe('Witnesses, confidence and review (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let model: FakeVisionModel;
  let verification: VerificationService;
  let electionId: string;
  let reviewer: { cookie: string; email: string };
  let declarations: { cookie: string; email: string };
  const reporterIds: string[] = [];

  beforeAll(async () => {
    model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(VisionModel).useValue(model).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    verification = app.get(VerificationService);
    await addTestUnits(app);
    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({
        type: 'governorship',
        title: 'E2E witness election',
        electionDate: '2026-11-01',
        scopeLevel: 'state',
        scopeCode: '24',
        pollsCloseAt: new Date('2026-11-01T13:30:00Z'),
        status: 'active',
      })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
    reviewer = await signInNewAdmin(app, 'reviewer');
    declarations = await signInNewAdmin(app, 'declarations_admin');
  });

  afterAll(async () => {
    await removeElection(app, electionId);
    if (reporterIds.length) {
      await db.delete(captureSessions).where(inArray(captureSessions.reporterId, reporterIds));
      await db.delete(reporters).where(inArray(reporters.id, reporterIds));
    }
    await db.delete(parties).where(inArray(parties.acronym, P));
    await removeAdmins(app, [reviewer.email, declarations.email]);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  /** A voter (new phone number) on a device; returns a function that submits a verified poster. */
  async function voter(deviceId: string) {
    const phone = `0909${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const res = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0].split(';')[0];
    return async (reading: Ec60eReading) => {
      const up = await request(app.getHttpServer())
        .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=${TEST_UNIT}`)
        .set('Cookie', cookie)
        .set('X-Device-Id', deviceId)
        .set('Content-Type', 'image/jpeg')
        .send(jpeg())
        .expect(201);
      const [row] = await db.select({ reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.id, up.body.id));
      if (!reporterIds.includes(row.reporterId)) reporterIds.push(row.reporterId);
      model.next.push(reading);
      await verification.process(up.body.id);
      return up.body.id as string;
    };
  }

  const publicResult = async () => {
    const res = await request(app.getHttpServer()).get(`/results/units/${TEST_UNIT}`).expect(200);
    return res.body.results.find((r: { election: { id: string } }) => r.election.id === electionId);
  };

  it('starts unconfirmed, then counts the first accepted photo with low confidence', async () => {
    expect((await publicResult()).status).toBe('not_confirmed');
    await (await voter(randomUUID()))(poster(120, 80));
    expect(await publicResult()).toMatchObject({
      status: 'counted',
      witnessCount: 1,
      confidence: 'low',
      figures: { partyVotes: { [P[0]]: 120, [P[1]]: 80 } },
    });
  });

  it('raises confidence as independent witnesses agree', async () => {
    await (await voter(randomUUID()))(poster(120, 80));
    expect(await publicResult()).toMatchObject({ status: 'counted', witnessCount: 2, confidence: 'medium' });
  });

  it('counts photos from one device as one witness, so a conflicting version cannot win by SIM-swapping', async () => {
    const device = randomUUID();
    await (await voter(device))(poster(80, 120));
    await (await voter(device))(poster(80, 120));
    await (await voter(device))(poster(80, 120));
    // 2 witnesses for 120-80 vs 1 witness (one device) for 80-120: still a clear lead
    expect(await publicResult()).toMatchObject({ status: 'counted', witnessCount: 2, versionCount: 2 });
  });

  it('marks a tie as disputed and hides the figures publicly', async () => {
    await (await voter(randomUUID()))(poster(80, 120));
    const r = await publicResult();
    expect(r).toMatchObject({ status: 'disputed', figures: null, versionCount: 2 });
    const changes = await db.select().from(auditLog).where(and(eq(auditLog.action, 'unit.result_changed'), like(auditLog.targetId, `${electionId}:%`)));
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it('lists the disputed unit for review and shows every version with its photos', async () => {
    const queue = await request(app.getHttpServer()).get('/admin/review/queue').set('Cookie', reviewer.cookie).expect(200);
    expect(queue.body.some((u: { unitCode: string; status: string }) => u.unitCode === TEST_UNIT && u.status === 'disputed')).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/admin/review/elections/${electionId}/units/${TEST_UNIT}`)
      .set('Cookie', reviewer.cookie)
      .expect(200);
    expect(detail.body.versions).toHaveLength(2);
    expect(detail.body.photos.length).toBe(6);

    const photo = await request(app.getHttpServer()).get(`/admin/review/photos/${detail.body.photos[0].id}`).set('Cookie', reviewer.cookie).expect(200);
    expect(photo.headers['content-type']).toMatch(/image\/jpeg/);
    await request(app.getHttpServer()).get(`/admin/review/photos/${detail.body.photos[0].id}`).expect(401);
  });

  it('lets a reviewer resolve the dispute with a reason; other roles cannot', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/admin/review/elections/${electionId}/units/${TEST_UNIT}`)
      .set('Cookie', reviewer.cookie)
      .expect(200);
    const chosen = detail.body.versions.find((v: { figures: { partyVotes: Record<string, number> } }) => v.figures.partyVotes[P[0]] === 120);
    const body = { electionId, unitCode: TEST_UNIT, versionId: chosen.id, reason: 'Two stamped photos match the poster seen on the video.' };

    await request(app.getHttpServer()).post('/admin/review/resolve').set('Cookie', declarations.cookie).set('Origin', ORIGIN).send(body).expect(403);
    await request(app.getHttpServer()).post('/admin/review/resolve').set('Cookie', reviewer.cookie).set('Origin', ORIGIN).send({ ...body, reason: 'short' }).expect(400);
    const res = await request(app.getHttpServer()).post('/admin/review/resolve').set('Cookie', reviewer.cookie).set('Origin', ORIGIN).send(body).expect(200);
    expect(res.body.result).toMatchObject({ status: 'resolved', countedVersionId: chosen.id });

    expect(await publicResult()).toMatchObject({ status: 'resolved', figures: { partyVotes: { [P[0]]: 120 } } });
  });

  it('keeps the reviewer decision when new photos arrive, but flags the unit again', async () => {
    await (await voter(randomUUID()))(poster(80, 120));
    expect((await publicResult()).status).toBe('resolved');
    const [row] = await db.select().from(unitResults).where(eq(unitResults.electionId, electionId));
    expect(row.flags).toContain('new_evidence_after_resolution');
  });
});
