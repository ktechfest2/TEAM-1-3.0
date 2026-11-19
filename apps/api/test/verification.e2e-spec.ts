import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import {
  captureSessions,
  electionParties,
  elections,
  lgas,
  parties,
  pollingUnits,
  rejectionLog,
  reporters,
  submissions,
  wards,
} from '../src/database/schema.js';
import { GeographyService } from '../src/geography/geography.service.js';
import { parseRegister } from '../src/geography/register.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';

/** Fake model: returns whatever reading the test queues next. */
class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  next: Ec60eReading[] = [];
  async read(): Promise<Ec60eReading> {
    const r = this.next.shift();
    if (!r) throw new Error('no fake reading queued');
    return r;
  }
}

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`TA${tag}`, `TB${tag}`];
const UNIT = '24-98-01-001';

const reading = (over: Partial<Ec60eReading> = {}): Ec60eReading => ({
  is_ec60e: true,
  document_description: 'EC60E poster',
  image_quality: 'good',
  stamp_visible: true,
  signature_present: true,
  election_type_on_form: 'Governorship',
  polling_unit_code: '24/98/01/001',
  polling_unit_name: 'TEST UNIT',
  party_results: [
    { party: P[0], votes: 120, legible: true },
    { party: P[1], votes: 80, legible: true },
  ],
  total_valid_votes: 200,
  rejected_votes: 5,
  total_votes_cast: 205,
  notes: '',
  ...over,
});

const jpeg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1024, fill)]);

describe('Photo verification (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let model: FakeVisionModel;
  let verification: VerificationService;
  let electionId: string;
  const voters: { phone: string; cookie: string }[] = [];

  beforeAll(async () => {
    model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VisionModel)
      .useValue(model)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    verification = app.get(VerificationService);

    // A test polling unit in a fictional LGA (24-98), parties and an active election that closed in the past
    const { rows } = parseRegister(`pu_code,pu_name,ward_name,lga_name,state_name\n${UNIT},TEST UNIT,TEST WARD,TEST LGA,Lagos\n`);
    await app.get(GeographyService).importRegister(rows);
    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({
        type: 'governorship',
        title: 'E2E verification election',
        electionDate: '2026-11-01',
        scopeLevel: 'state',
        scopeCode: '24',
        pollsCloseAt: new Date('2026-11-01T13:30:00Z'),
        status: 'active',
      })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));

    for (let i = 0; i < 2; i++) {
      const phone = `0909${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      const res = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0].split(';')[0];
      voters.push({ phone, cookie });
    }
  });

  afterAll(async () => {
    const subs = await db.select({ id: submissions.id, reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.electionId, electionId));
    const reporterIds = [...new Set(subs.map((s) => s.reporterId))];
    await db.delete(submissions).where(eq(submissions.electionId, electionId));
    await db.delete(rejectionLog).where(eq(rejectionLog.electionId, electionId));
    if (reporterIds.length) {
      await db.delete(captureSessions).where(inArray(captureSessions.reporterId, reporterIds));
      await db.delete(reporters).where(inArray(reporters.id, reporterIds));
    }
    await db.delete(electionParties).where(eq(electionParties.electionId, electionId));
    await db.delete(elections).where(eq(elections.id, electionId));
    await db.delete(parties).where(inArray(parties.acronym, P));
    await db.delete(pollingUnits).where(like(pollingUnits.code, '24-98-%'));
    await db.delete(wards).where(like(wards.code, '24-98-%'));
    await db.delete(lgas).where(eq(lgas.code, '24-98'));
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  async function upload(voter = 0, fill = Math.floor(Math.random() * 255)) {
    const res = await request(app.getHttpServer())
      .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}`)
      .set('Cookie', voters[voter].cookie)
      .set('Content-Type', 'image/jpeg')
      .send(jpeg(fill))
      .expect(201);
    return res.body.id as string;
  }

  const status = (id: string, voter = 0) =>
    request(app.getHttpServer()).get(`/capture/photos/${id}`).set('Cookie', voters[voter].cookie);

  const imageExists = async (id: string) => {
    const [row] = await db.select({ key: submissions.imageKey }).from(submissions).where(eq(submissions.id, id));
    if (!row.key) return false;
    return access(join(process.env.EVIDENCE_DIR!, row.key)).then(() => true, () => false);
  };

  it('accepts a good poster: figures stored against the polling unit', async () => {
    const id = await upload();
    expect((await status(id).expect(200)).body.status).toBe('pending');

    model.next.push(reading());
    const decision = await verification.process(id);
    expect(decision?.outcome).toBe('verified');

    const res = await status(id).expect(200);
    expect(res.body).toMatchObject({
      status: 'verified',
      unitCode: UNIT,
      figures: { partyVotes: { [P[0]]: 120, [P[1]]: 80 }, totalValid: 200, rejected: 5, totalCast: 205 },
    });
    expect(await imageExists(id)).toBe(true);
    const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
    expect(row.model).toBe('fake-model');
    expect(row.verification).toMatchObject({ decision: { outcome: 'verified' } });
  });

  it('asks for a retake of a blurred photo and deletes the image', async () => {
    const id = await upload();
    model.next.push(reading({ image_quality: 'blurred' }));
    await verification.process(id);
    const res = await status(id).expect(200);
    expect(res.body).toMatchObject({ status: 'rejected', retake: true });
    expect(res.body.reason).toMatch(/blurred/);
    expect(await imageExists(id)).toBe(false);
    const logs = await db.select().from(rejectionLog).where(eq(rejectionLog.electionId, electionId));
    expect(logs.some((l) => l.reason === 'quality_blurred')).toBe(true);
  });

  it('rejects an image that is not an EC60E', async () => {
    const id = await upload();
    model.next.push(reading({ is_ec60e: false, document_description: 'a selfie' }));
    await verification.process(id);
    expect((await status(id).expect(200)).body).toMatchObject({ status: 'rejected', retake: false });
    expect(await imageExists(id)).toBe(false);
  });

  it('asks the voter to confirm figures that do not add up; confirming keeps it, disputing discards it', async () => {
    const kept = await upload();
    model.next.push(reading({ total_valid_votes: 201 }));
    await verification.process(kept);
    const pending = await status(kept).expect(200);
    expect(pending.body.status).toBe('needs_confirmation');
    expect(pending.body.reason).toMatch(/add up to 200/);
    const confirmed = await request(app.getHttpServer())
      .post(`/capture/photos/${kept}/confirm`)
      .set('Cookie', voters[0].cookie)
      .send({ confirmed: true })
      .expect(200);
    expect(confirmed.body.status).toBe('verified');

    const disputed = await upload();
    model.next.push(reading({ total_valid_votes: 201 }));
    await verification.process(disputed);
    const res = await request(app.getHttpServer())
      .post(`/capture/photos/${disputed}/confirm`)
      .set('Cookie', voters[0].cookie)
      .send({ confirmed: false })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'rejected', retake: true });
    expect(await imageExists(disputed)).toBe(false);
  });

  it('keeps a shared image file when another submission still uses identical bytes', async () => {
    const first = await upload(0, 7);
    const second = await upload(1, 7); // same bytes, different voter
    model.next.push(reading());
    await verification.process(first);
    model.next.push(reading({ is_ec60e: false }));
    await verification.process(second);
    expect(await imageExists(first)).toBe(true);
  });

  it('retries later when the model fails, without losing the photo', async () => {
    const id = await upload();
    const claimed = await verification.claim(10);
    expect(claimed).toContain(id);
    // No reading queued: the fake model throws
    await expect(verification.process(id)).rejects.toThrow();
    const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
    expect(row.status).toBe('pending');
    expect(row.processingAttempts).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await imageExists(id)).toBe(true);
    // Not claimable again until the retry time
    expect(await verification.claim(10)).not.toContain(id);
  });

  it("never shows one voter another voter's photo", async () => {
    const id = await upload(0);
    await status(id, 1).expect(404);
    await request(app.getHttpServer()).post(`/capture/photos/${id}/confirm`).set('Cookie', voters[1].cookie).send({ confirmed: true }).expect(404);
  });
});
