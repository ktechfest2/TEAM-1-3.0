import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SmsService } from '../src/channels/sms.service.js';
import { LogTwoWaySms, TwoWaySms } from '../src/channels/sms-client.js';
import type { Database } from '../src/database/database.module.js';
import {
  captureLinks,
  captureSessions,
  electionParties,
  elections,
  parties,
  reporters,
  resultVersions,
  submissions,
  whatsappContacts,
  whatsappMessages,
} from '../src/database/schema.js';
import type { Ec60eReading } from '../src/verification/reading.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { VisionModel } from '../src/verification/vision-model.js';
import { addTestUnits, removeElection, removeTestUnits } from './helpers.js';

const TOKEN = 'test-only-channels-token-0123456789';
const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`SA${tag}`, `SB${tag}`];

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

describe('SMS and USSD channels (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: LogTwoWaySms;
  let electionId: string;
  const smsVoter = `+23480${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const ussdVoter = `+23481${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  let seq = 0;

  const text = async (from: string, body: string, id = `${tag}-${++seq}`) => {
    await request(app.getHttpServer()).post(`/channels/${TOKEN}/sms`).type('form').send({ from, to: '12345', text: body, id, date: new Date().toISOString() }).expect(200);
    await app.get(SmsService).idle();
    return sms.sent.filter((m) => m.to === from).at(-1)?.message ?? '';
  };
  let session = 0;
  const dial = async (phoneNumber: string, steps: string) => {
    if (!steps.includes('*')) session++; // a new dial starts a new session
    return (await request(app.getHttpServer()).post(`/channels/${TOKEN}/ussd`).type('form').send({ sessionId: `s${tag}-${session}`, serviceCode: '*384*1#', phoneNumber, text: steps }).expect(200)).text;
  };

  beforeAll(async () => {
    const model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(VisionModel).useValue(model).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    sms = app.get(TwoWaySms) as LogTwoWaySms;
    await addTestUnits(app);
    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({ type: 'local_government', title: 'E2E SMS election', electionDate: '2026-11-01', scopeLevel: 'lga', scopeCode: '24-98', pollsCloseAt: new Date('2026-11-01T13:30:00Z'), status: 'active' })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));
    const start = await request(app.getHttpServer()).post('/capture/start').send({ phone: '09097654321', consent: true }).expect(200);
    const up = await request(app.getHttpServer())
      .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=24-98-01-001`)
      .set('Authorization', `Bearer ${start.body.token}`)
      .set('X-Device-Id', randomUUID())
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]))
      .expect(201);
    model.next.push({
      is_ec60e: true, document_description: 'EC60E', image_quality: 'good', stamp_visible: true, signature_present: true,
      election_type_on_form: null, polling_unit_code: null, polling_unit_name: null,
      party_results: [{ party: P[0], votes: 100, legible: true }, { party: P[1], votes: 50, legible: true }],
      total_valid_votes: 150, rejected_votes: null, total_votes_cast: null, notes: '',
    });
    await app.get(VerificationService).process(up.body.id);
  });

  afterAll(async () => {
    const ids = (await db.select({ id: whatsappContacts.id }).from(whatsappContacts)).map((c) => c.id);
    await db.delete(whatsappMessages);
    if (ids.length) await db.delete(whatsappContacts).where(inArray(whatsappContacts.id, ids));
    const reporterIds = [...new Set((await db.select({ id: submissions.reporterId }).from(submissions).where(eq(submissions.electionId, electionId))).map((r) => r.id))];
    await removeElection(app, electionId);
    const linkReporters = (await db.select({ id: captureLinks.reporterId }).from(captureLinks)).map((r) => r.id);
    const all = [...new Set([...reporterIds, ...linkReporters])];
    if (all.length) {
      await db.delete(captureLinks).where(inArray(captureLinks.reporterId, all));
      await db.delete(captureSessions).where(inArray(captureSessions.reporterId, all));
      await db.delete(reporters).where(inArray(reporters.id, all));
    }
    await db.delete(parties).where(inArray(parties.acronym, P));
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  it('answers the address check from Africa\'s Talking only with the secret token', async () => {
    expect((await request(app.getHttpServer()).get(`/channels/${TOKEN}/ussd`).expect(200)).text).toBe('OK');
    await request(app.getHttpServer()).get(`/channels/${TOKEN}/sms`).expect(200);
    await request(app.getHttpServer()).get('/channels/wrong-token-wrong-token-wrong/ussd').expect(404);
    // An empty POST (address check) is answered, not rejected
    expect((await request(app.getHttpServer()).post(`/channels/${TOKEN}/sms`).expect(200)).text).toBe('OK');
    expect((await request(app.getHttpServer()).post(`/channels/${TOKEN}/ussd`).expect(200)).text).toBe('END TrustElect');
  });

  it('refuses callbacks without the secret token', async () => {
    await request(app.getHttpServer()).post('/channels/wrong-token-wrong-token-wrong/sms').type('form').send({ from: smsVoter, text: 'hi', id: 'x' }).expect(404);
    await request(app.getHttpServer()).post('/channels/wrong-token-wrong-token-wrong/ussd').type('form').send({ phoneNumber: ussdVoter, text: '' }).expect(404);
  });

  it('SMS: consent, lookups, typed figures, camera link and opt-out', async () => {
    expect(await text(smsVoter, '24-98-01-001')).toMatch(/Reply YES to agree/);
    expect(await text(smsVoter, 'YES')).toMatch(/Text a polling unit/);
    expect(await text(smsVoter, '24-98-01-001')).toMatch(new RegExp(`${P[0]} 100 · ${P[1]} 50`));
    expect(await text(smsVoter, `PU 24-98-01-001 ${P[0]} 100 ${P[1]} 50`)).toMatch(/match a result photographed by 1 witness/);
    const [v] = await db.select().from(resultVersions).where(eq(resultVersions.electionId, electionId));
    expect(v.typedSupportCount).toBe(1);
    expect(await text(smsVoter, 'PHOTO')).toMatch(/\/capture\?link=/);
    expect(await text(smsVoter, 'thugs are attacking voters')).toMatch(/call 112/);
    expect(await text(smsVoter, 'STOP')).toMatch(/will not use your number/);
    expect(await text(smsVoter, '24-98-01-001')).toMatch(/Reply YES to agree/);

    // A repeated delivery of the same message is ignored
    const before = sms.sent.length;
    await text(smsVoter, 'hello', 'dup-1');
    await text(smsVoter, 'hello', 'dup-1');
    expect(sms.sent.length).toBe(before + 1);
  });

  it('USSD: menu, result check with keypad codes, figures with consent, link by SMS', async () => {
    expect(await dial(ussdVoter, '')).toMatch(/^CON TrustElect[\s\S]*1\. Check a result/);
    expect(await dial(ussdVoter, '1')).toMatch(/^CON Enter the polling unit code/);
    const result = await dial(ussdVoter, '1*249801001');
    expect(result).toMatch(/^END TEST UNIT/);
    expect(result).toMatch(new RegExp(`${P[0]} 100`));
    expect(result.length).toBeLessThanOrEqual(184);

    expect(await dial(ussdVoter, '2')).toMatch(/^CON Your number is stored encrypted[\s\S]*1\. I agree/);
    expect(await dial(ussdVoter, '2*2')).toBe('END Cancelled. Nothing was stored.');
    expect(await dial(ussdVoter, '2*1')).toMatch(/^CON Enter the polling unit code/);
    expect(await dial(ussdVoter, '2*1*249801001')).toMatch(new RegExp(`${P[0]} votes:`));
    expect(await dial(ussdVoter, '2*1*249801001*100')).toMatch(new RegExp(`${P[1]} votes:`));
    expect(await dial(ussdVoter, '2*1*249801001*100*50')).toMatch(new RegExp(`CON 24-98-01-001: ${P[0]} 100 ${P[1]} 50\\n1\\. Send`));
    expect(await dial(ussdVoter, '2*1*249801001*100*50*1')).toMatch(/^END Recorded for 24-98-01-001/);
    const [v] = await db.select().from(resultVersions).where(eq(resultVersions.electionId, electionId));
    expect(v.typedSupportCount).toBe(2);

    // Consent given once: next time the menu goes straight on
    expect(await dial(ussdVoter, '3')).toMatch(/^END We have sent you an SMS/);
    expect(sms.sent.filter((m) => m.to === ussdVoter).at(-1)?.message).toMatch(/\/capture\?link=/);
    expect(await dial(ussdVoter, '4')).toMatch(/call 112/);
  });
});
