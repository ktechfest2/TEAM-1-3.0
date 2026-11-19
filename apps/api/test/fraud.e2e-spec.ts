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
import { auditLog, captureSessions, electionParties, elections, parties, rejectionLog, reporters, submissions, unitResults } from '../src/database/schema.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, ORIGIN, removeAdmins, removeElection, removeTestUnits, signInNewAdmin } from './helpers.js';

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`FA${tag}`, `FB${tag}`];

class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  async read(): Promise<Ec60eReading> {
    return {
      is_ec60e: true, document_description: 'EC60E', image_quality: 'good', stamp_visible: true, signature_present: true,
      election_type_on_form: null, polling_unit_code: null, polling_unit_name: null,
      party_results: [{ party: P[0], votes: 90, legible: true }, { party: P[1], votes: 10, legible: true }],
      total_valid_votes: 100, rejected_votes: null, total_votes_cast: null, notes: '',
    };
  }
  async readDeclaration(): Promise<never> {
    throw new Error('not used');
  }
}

describe('Anti-fraud and blocking (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let electionId: string;
  let reviewer: { cookie: string; email: string };
  const tokens: string[] = [];
  const reporterIds: string[] = [];

  const witness = async (image: Buffer, deviceId = randomUUID()) => {
    const phone = `0907${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const start = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
    tokens.push(start.body.token);
    const up = await request(app.getHttpServer())
      .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=24-98-01-001`)
      .set('Authorization', `Bearer ${start.body.token}`)
      .set('X-Device-Id', deviceId)
      .set('Content-Type', 'image/jpeg')
      .send(image)
      .expect(201);
    const [row] = await db.select({ reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.id, up.body.id));
    reporterIds.push(row.reporterId);
    await app.get(VerificationService).process(up.body.id);
    return { token: start.body.token as string, reporterId: row.reporterId };
  };
  const unit = async () => (await db.select().from(unitResults).where(eq(unitResults.electionId, electionId)))[0];
  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(VisionModel).useValue(new FakeVisionModel()).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    await addTestUnits(app);
    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({ type: 'local_government', title: 'E2E fraud election', electionDate: '2026-11-01', scopeLevel: 'lga', scopeCode: '24-98', pollsCloseAt: new Date('2026-11-01T13:30:00Z'), status: 'active' })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
    reviewer = await signInNewAdmin(app, 'reviewer');
  });

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.targetId, reporterIds));
    await removeElection(app, electionId);
    await db.delete(rejectionLog).where(inArray(rejectionLog.reporterId, reporterIds));
    await db.delete(captureSessions).where(inArray(captureSessions.reporterId, reporterIds));
    await db.delete(reporters).where(inArray(reporters.id, reporterIds));
    await db.delete(parties).where(inArray(parties.acronym, P));
    await removeAdmins(app, [reviewer.email]);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  it('counts one picture sent from several numbers as one witness, and shows the cluster', async () => {
    const shared = jpeg();
    await witness(shared);
    await witness(shared); // same bytes, another number
    await witness(jpeg());
    const u = await unit();
    expect(u.witnessCount).toBe(2);
    expect(u.flags).toContain('same_picture_several_numbers');

    const abuse = (await request(app.getHttpServer()).get('/admin/abuse').set('Cookie', reviewer.cookie).expect(200)).body;
    const cluster = abuse.samePicture.find((c: { unitCode: string }) => c.unitCode === '24-98-01-001');
    expect(cluster.numbers).toHaveLength(2);
    expect(cluster.numbers[0].phone).toMatch(/^\+234 \*\*\* \*\*\* \*\d{3}$/); // masked
  });

  it('lists one device behind several numbers', async () => {
    const device = randomUUID();
    await witness(jpeg(), device);
    await witness(jpeg(), device);
    const abuse = (await request(app.getHttpServer()).get('/admin/abuse').set('Cookie', reviewer.cookie).expect(200)).body;
    expect(abuse.sharedDevices.some((d: { numbers: unknown[] }) => d.numbers.length === 2)).toBe(true);
  });

  it('suggests numbers whose photos keep being rejected', async () => {
    const id = reporterIds[0];
    await db.insert(rejectionLog).values([1, 2, 3].map(() => ({ reporterId: id, electionId, reason: 'not_ec60e' })));
    const abuse = (await request(app.getHttpServer()).get('/admin/abuse').set('Cookie', reviewer.cookie).expect(200)).body;
    expect(abuse.repeatedRejections.find((r: { number: { reporterId: string } }) => r.number.reporterId === id)).toMatchObject({ rejections: 3 });
  });

  it('blocks a number on every channel and stops its evidence counting; unblocking restores it', async () => {
    const before = (await unit()).witnessCount;
    const victim = reporterIds[2]; // the one with a distinct picture
    const post = (path: string, body: object) => request(app.getHttpServer()).post(path).set('Cookie', reviewer.cookie).set('Origin', ORIGIN).send(body);
    await post(`/admin/abuse/numbers/${victim}/block`, { reason: 'Sends fake posters' }).expect(200);
    expect((await unit()).witnessCount).toBe(before - 1);
    await request(app.getHttpServer()).get('/capture/session').set('Authorization', `Bearer ${tokens[2]}`).expect(401);
    await post(`/admin/abuse/numbers/${victim}/block`, { reason: 'again' }).expect(409);
    const blocked = (await request(app.getHttpServer()).get('/admin/abuse/blocked').set('Cookie', reviewer.cookie).expect(200)).body;
    expect(blocked.find((b: { reporterId: string }) => b.reporterId === victim)).toMatchObject({ reason: 'Sends fake posters' });

    await post(`/admin/abuse/numbers/${victim}/unblock`, { reason: 'Reviewed: genuine' }).expect(200);
    expect((await unit()).witnessCount).toBe(before);
  });
});
