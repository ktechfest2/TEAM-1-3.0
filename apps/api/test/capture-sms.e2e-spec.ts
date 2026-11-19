import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Database } from '../src/database/database.module.js';
import { captureSessions, elections, reporters, submissions, voterOtps } from '../src/database/schema.js';
import { keyedHash } from '../src/security/encryption.js';
import { addTestUnits, removeTestUnits, TEST_UNIT } from './helpers.js';

/** A minimal byte sequence that starts like a JPEG */
const jpeg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, fill)]);

describe('Voter capture with SMS verification switched on (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let activeElection: string;
  let draftElection: string;
  // Random test number in the 0909 range
  const phone = `0909${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const e164 = `+234${phone.slice(1)}`;
  let phoneHash: string;
  let cookie: string;

  beforeAll(async () => {
    // Switch SMS verification on before the app module (and its config) loads
    process.env.CAPTURE_PHONE_VERIFICATION = 'sms';
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    phoneHash = keyedHash(process.env.PHONE_HASH_KEY!, e164);
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
    await db.delete(voterOtps).where(eq(voterOtps.phoneHash, phoneHash));
    await db.delete(elections).where(inArray(elections.id, [activeElection, draftElection]));
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('reports SMS mode and disables the no-code start', async () => {
    expect((await request(server()).get('/capture/config').expect(200)).body).toEqual({ phoneVerification: 'sms' });
    await request(server()).post('/capture/start').send({ phone, consent: true }).expect(404);
  });

  it('rejects numbers that are not Nigerian mobiles', async () => {
    await request(server()).post('/capture/code').send({ phone: '+447911123456' }).expect(400);
  });

  it('refuses photos without a verified phone', async () => {
    await request(server())
      .post(`/capture/photos?electionId=${activeElection}&clientId=${randomUUID()}&unitCode=${TEST_UNIT}`)
      .set('Content-Type', 'image/jpeg')
      .send(jpeg(1))
      .expect(401);
  });

  it('verifies a phone with a one-time code and requires consent', async () => {
    const sent = await request(server()).post('/capture/code').send({ phone }).expect(200);
    expect(sent.body.phoneMasked).toMatch(/\*\d{3}$/);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);

    await request(server()).post('/capture/verify').send({ phone, code: sent.body.devCode }).expect(400); // no consent
    const wrong = sent.body.devCode === '000000' ? '111111' : '000000';
    await request(server()).post('/capture/verify').send({ phone, code: wrong, consent: true }).expect(401);

    const ok = await request(server()).post('/capture/verify').send({ phone, code: sent.body.devCode, consent: true }).expect(200);
    cookie = ([] as string[]).concat(ok.headers['set-cookie'] ?? []).find((c) => c.startsWith('te_capture='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    cookie = cookie.split(';')[0];

    // The code cannot be used twice
    await request(server()).post('/capture/verify').send({ phone, code: sent.body.devCode, consent: true }).expect(401);

    // The phone number is stored encrypted, never in the clear
    const [reporter] = await db.select().from(reporters).where(eq(reporters.phoneHash, phoneHash));
    expect(reporter.phoneEncrypted).not.toContain(e164.slice(4));
    expect(reporter.consentAt).not.toBeNull();

    const session = await request(server()).get('/capture/session').set('Cookie', cookie).expect(200);
    expect(session.body.phoneMasked).toBe(sent.body.phoneMasked);
  });

  it('accepts a photo once, and treats retries of the same clientId as the same submission', async () => {
    const clientId = randomUUID();
    const url = `/capture/photos?electionId=${activeElection}&clientId=${clientId}&unitCode=${TEST_UNIT}&capturedAt=${encodeURIComponent(new Date().toISOString())}&lat=6.45&lng=3.39&accuracy=12`;
    const first = await request(server()).post(url).set('Cookie', cookie).set('Content-Type', 'image/jpeg').send(jpeg(2)).expect(201);
    expect(first.body.status).toBe('pending');
    expect(first.body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const retry = await request(server()).post(url).set('Cookie', cookie).set('Content-Type', 'image/jpeg').send(jpeg(2)).expect(200);
    expect(retry.body.id).toBe(first.body.id);

    const [row] = await db.select().from(submissions).where(eq(submissions.id, first.body.id));
    expect(row).toMatchObject({ kind: 'photo', channel: 'web', imageType: 'image/jpeg', latitude: 6.45, locationAccuracy: 12 });
  });

  it('rejects non-images, draft elections and unknown elections', async () => {
    const send = (electionId: string, body: Buffer, type = 'image/jpeg') =>
      request(server())
        .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=${TEST_UNIT}`)
        .set('Cookie', cookie)
        .set('Content-Type', type)
        .send(body);
    await send(activeElection, Buffer.from('<svg/> pretending to be a jpeg')).expect(400);
    await send(draftElection, jpeg(3)).expect(400);
    await send(randomUUID(), jpeg(4)).expect(400);
    await send(activeElection, Buffer.from('{}'), 'application/json').expect(400);
  });

  it('ends the session on logout', async () => {
    await request(server()).post('/capture/logout').set('Cookie', cookie).expect(200);
    await request(server()).get('/capture/session').set('Cookie', cookie).expect(401);
  });
});
