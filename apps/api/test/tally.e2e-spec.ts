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
import { captureSessions, electionParties, elections, parties, reporters, submissions } from '../src/database/schema.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, removeElection, removeTestUnits } from './helpers.js';

class FakeVisionModel extends VisionModel {
  readonly name = 'fake-model';
  next: Ec60eReading[] = [];
  async read(): Promise<Ec60eReading> {
    return this.next.shift()!;
  }
}

const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`TA${tag}`, `TB${tag}`];

const poster = (a: number, b: number, rejected: number | null = null): Ec60eReading => ({
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
  rejected_votes: rejected,
  total_votes_cast: rejected === null ? null : a + b + rejected,
  notes: '',
});

describe('Counting engine and live results (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let model: FakeVisionModel;
  let verification: VerificationService;
  let electionId: string;
  let baseUrl: string;
  const reporterIds: string[] = [];

  beforeAll(async () => {
    model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(VisionModel).useValue(model).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
    db = app.get(getDrizzleToken());
    verification = app.get(VerificationService);
    await addTestUnits(app);
    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({
        type: 'local_government',
        title: 'E2E tally election',
        electionDate: '2026-11-01',
        scopeLevel: 'lga',
        scopeCode: '24-98',
        pollsCloseAt: new Date('2026-11-01T13:30:00Z'),
        status: 'active',
      })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
  });

  afterAll(async () => {
    await removeElection(app, electionId);
    if (reporterIds.length) {
      await db.delete(captureSessions).where(inArray(captureSessions.reporterId, reporterIds));
      await db.delete(reporters).where(inArray(reporters.id, reporterIds));
    }
    await db.delete(parties).where(inArray(parties.acronym, P));
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  async function photo(unitCode: string, reading: Ec60eReading) {
    const phone = `0909${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const start = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
    const cookie = ([] as string[]).concat(start.headers['set-cookie'] ?? [])[0].split(';')[0];
    const up = await request(app.getHttpServer())
      .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=${unitCode}`)
      .set('Cookie', cookie)
      .set('X-Device-Id', randomUUID())
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]))
      .expect(201);
    const [row] = await db.select({ reporterId: submissions.reporterId }).from(submissions).where(eq(submissions.id, up.body.id));
    reporterIds.push(row.reporterId);
    model.next.push(reading);
    await verification.process(up.body.id);
  }

  const tally = (query = '') => request(app.getHttpServer()).get(`/results/elections/${electionId}${query}`);

  it('starts at the election area with full coverage information and nothing counted', async () => {
    const res = await tally().expect(200);
    expect(res.body.area).toMatchObject({ level: 'lga', code: '24-98', name: 'TEST LGA' });
    expect(res.body.area.path.map((p: { name: string }) => p.name)).toEqual(['Nigeria', 'Lagos', 'TEST LGA']);
    expect(res.body.childLevel).toBe('ward');
    expect(res.body.totals).toMatchObject({ totalUnits: 3, countedUnits: 0, totalValid: 0, mix: { notConfirmed: 3 } });
    expect(res.body.parties.map((p: { acronym: string }) => p.acronym)).toEqual(P);
  });

  it('adds counted units up the levels, with the confidence mix, and leaves disputed units out', async () => {
    // Unit 1: two witnesses agree (medium). Unit 2: one witness (low). Unit 3: a tie (disputed).
    await photo('24-98-01-001', poster(100, 50, 4));
    await photo('24-98-01-001', poster(100, 50, 4));
    await photo('24-98-01-002', poster(30, 70));
    await photo('24-98-02-001', poster(10, 10));
    await photo('24-98-02-001', poster(20, 0));

    const lga = (await tally().expect(200)).body;
    expect(lga.totals).toMatchObject({
      totalUnits: 3,
      countedUnits: 2,
      partyVotes: { [P[0]]: 130, [P[1]]: 120 },
      totalValid: 250,
      rejected: 4,
      rejectedReportedUnits: 1,
      mix: { high: 0, medium: 1, low: 1, provisional: 0, disputed: 1, notConfirmed: 0 },
    });
    const ward1 = lga.children.find((c: { code: string }) => c.code === '24-98-01');
    expect(ward1).toMatchObject({ totalUnits: 2, countedUnits: 2, totalValid: 250 });

    const ward = (await tally('?level=ward&code=24-98-02').expect(200)).body;
    expect(ward.childLevel).toBe('polling_unit');
    expect(ward.children[0]).toMatchObject({ code: '24-98-02-001', status: 'disputed', countedUnits: 0, totalValid: 0 });
  });

  it('refuses levels above, or areas outside, the election', async () => {
    await tally('?level=national').expect(400);
    await tally('?level=state&code=24').expect(400);
    await tally('?level=ward&code=19-98-01').expect(400);
    await request(app.getHttpServer()).get(`/results/elections/${randomUUID()}`).expect(404);
  });

  it('pushes a live update to open dashboards when a unit result changes', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/results/elections/${electionId}/stream`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const received = (async () => {
      let text = '';
      while (!text.includes('event: update')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();

    await photo('24-98-01-002', poster(30, 70)); // second witness for unit 2: low -> medium
    const text = await received;
    controller.abort();
    expect(text).toContain('event: update');
    expect(text).toContain(electionId);

    const lga = (await tally().expect(200)).body;
    expect(lga.totals.mix).toMatchObject({ medium: 2, low: 0 });
  }, 20_000);
});
