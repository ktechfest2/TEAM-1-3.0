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
import { captureSessions, elections, reporters, submissions } from '../src/database/schema.js';
import { keyedHash } from '../src/security/encryption.js';
import { addTestUnits, removeElection, removeTestUnits, TEST_UNIT, TEST_UNIT_OUTSIDE_LAGOS } from './helpers.js';

const jpeg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, fill)]);

/** Default flow: the voter gives a phone number and consent, no SMS code. */
describe('Voter capture (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let activeElection: string;
  let draftElection: string;
  const phone = `0909${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  let phoneHash: string;
  let cookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    phoneHash = keyedHash(process.env.PHONE_HASH_KEY!, `+234${phone.slice(1)}`);
    await addTestUnits(app);
    const base = {
      type: 'governorship' as const,
      title: 'E2E capture election',
      electionDate: '2027-03-06',
      scopeLevel: 'state' as const,
      scopeCode: '24',
      pollsCloseAt: new Date('2027-03-06T13:30:00Z'),
    };
    [{ id: activeElection }] = await db.insert(elections).values({ ...base, status: 'active' }).returning({ id: elections.id });
    [{ id: draftElection }] = await db.insert(elections).values({ ...base, status: 'draft' }).returning({ id: elections.id });
  });

  afterAll(async () => {
    const [reporter] = await db.select().from(reporters).where(eq(reporters.phoneHash, phoneHash));
    if (reporter) {
      await db.delete(submissions).where(eq(submissions.reporterId, reporter.id));
      await db.delete(captureSessions).where(eq(captureSessions.reporterId, reporter.id));
      await db.delete(reporters).where(eq(reporters.id, reporter.id));
    }
    await removeElection(app, activeElection);
    await removeElection(app, draftElection);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('reports that no SMS code is needed, and keeps the SMS endpoints off', async () => {
    expect((await request(server()).get('/capture/config').expect(200)).body).toEqual({ phoneVerification: 'none' });
    await request(server()).post('/capture/code').send({ phone }).expect(404);
  });

  it('requires a Nigerian mobile number and consent', async () => {
    await request(server()).post('/capture/start').send({ phone: '+447911123456', consent: true }).expect(400);
    await request(server()).post('/capture/start').send({ phone }).expect(400);
  });

  it('refuses photos before the voter has given a number', async () => {
    await request(server())
      .post(`/capture/photos?electionId=${activeElection}&clientId=${randomUUID()}&unitCode=${TEST_UNIT}`)
      .set('Content-Type', 'image/jpeg')
      .send(jpeg(1))
      .expect(401);
  });

  it('starts a session from the phone number alone and stores it encrypted', async () => {
    const res = await request(server()).post('/capture/start').send({ phone, consent: true }).expect(200);
    expect(res.body.phoneMasked).toBe(`+234 *** *** *${phone.slice(-3)}`);
    cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('te_capture='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    cookie = cookie.split(';')[0];

    const [reporter] = await db.select().from(reporters).where(eq(reporters.phoneHash, phoneHash));
    expect(reporter.phoneEncrypted).not.toContain(phone.slice(1));
    expect(reporter.consentAt).not.toBeNull();
    const [session] = await db.select().from(captureSessions).where(eq(captureSessions.reporterId, reporter.id));
    expect(session.issuedVia).toBe('web');
  });

  it('accepts a photo once, and treats retries of the same clientId as the same submission', async () => {
    const clientId = randomUUID();
    const url = `/capture/photos?electionId=${activeElection}&clientId=${clientId}&unitCode=${TEST_UNIT}&capturedAt=${encodeURIComponent(new Date().toISOString())}&lat=6.45&lng=3.39&accuracy=12`;
    const first = await request(server()).post(url).set('Cookie', cookie).set('Content-Type', 'image/jpeg').send(jpeg(2)).expect(201);
    expect(first.body.status).toBe('pending');
    expect(first.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const retry = await request(server()).post(url).set('Cookie', cookie).set('Content-Type', 'image/jpeg').send(jpeg(2)).expect(200);
    expect(retry.body.id).toBe(first.body.id);
  });

  it('rejects non-images, draft elections and unknown elections', async () => {
    const send = (electionId: string, body: Buffer, type = 'image/jpeg', unit = TEST_UNIT) =>
      request(server())
        .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=${unit}`)
        .set('Cookie', cookie)
        .set('Content-Type', type)
        .send(body);
    await send(activeElection, Buffer.from('<svg/> pretending to be a jpeg')).expect(400);
    await send(draftElection, jpeg(3)).expect(400);
    await send(randomUUID(), jpeg(4)).expect(400);
  });

  it('requires a polling unit that is in the register and in the election area', async () => {
    const send = (unit: string) =>
      request(server())
        .post(`/capture/photos?electionId=${activeElection}&clientId=${randomUUID()}&unitCode=${unit}`)
        .set('Cookie', cookie)
        .set('Content-Type', 'image/jpeg')
        .send(jpeg(5));
    expect((await send('24-97-01-001').expect(400)).body.message).toMatch(/not in INEC's register/);
    expect((await send(TEST_UNIT_OUTSIDE_LAGOS).expect(400)).body.message).toMatch(/not part of this election's area/);
    expect((await send('banana').expect(400)).body.message).toMatch(/valid polling unit code|Invalid request/);
    // Slashes are accepted and the unit is stored with the photo
    const ok = await send('24/98/1/1').expect(201);
    const [row] = await db.select().from(submissions).where(eq(submissions.id, ok.body.id));
    expect(row.pollingUnitId).not.toBeNull();
  });

  it('ends the session on logout', async () => {
    await request(server()).post('/capture/logout').set('Cookie', cookie).expect(200);
    await request(server()).get('/capture/session').set('Cookie', cookie).expect(401);
  });
});
