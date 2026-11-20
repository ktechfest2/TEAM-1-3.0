import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
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
import { Assistant, type Understanding } from '../src/whatsapp/assistant.js';
import { LogWhatsAppClient, WhatsAppClient } from '../src/whatsapp/client.js';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service.js';
import { addTestUnits, removeElection, removeTestUnits } from './helpers.js';

const SECRET = 'test-only-whatsapp-app-secret';
const tag = Date.now().toString(36).toUpperCase().slice(-4);
const P = [`WA${tag}`, `WB${tag}`];

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

class FakeAssistant extends Assistant {
  async compose(): Promise<string | null> {
    return null;
  }
  next: Understanding | null = null;
  translations: string[] = [];
  translateWith: (text: string) => string = (t) => `[yo] ${t}`;
  async understand(): Promise<Understanding> {
    return this.next ?? { intent: 'other', language: 'en', unit_code: null, area_code: null, answer: null };
  }
  heard: { text: string; language: 'en' | 'pcm' | 'ha' | 'yo' | 'ig' } | null = null;
  async transcribe(): Promise<{ text: string; language: 'en' | 'pcm' | 'ha' | 'yo' | 'ig' } | null> {
    return this.heard;
  }
  async translate(text: string): Promise<string> {
    this.translations.push(text);
    return this.translateWith(text);
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

describe('WhatsApp channel (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let client: LogWhatsAppClient;
  let assistant: FakeAssistant;
  let electionId: string;
  const voter = `23490${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const foreign = `1415${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  let seq = 0;

  const send = async (from: string, message: Record<string, unknown>, opts: { signature?: string } = {}) => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1000000001' }, messages: [{ id: `wamid.${tag}.${++seq}`, from, ...message }] } }] }],
    });
    const signature = opts.signature ?? `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    const res = await request(app.getHttpServer()).post('/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(body);
    await app.get(WhatsAppService).idle();
    return res;
  };
  const text = (from: string, body: string) => send(from, { type: 'text', text: { body } });
  const choose = (from: string, id: string) => send(from, { type: 'interactive', interactive: { button_reply: { id, title: id } } });
  const last = (to: string) => client.sent.filter((m) => m.to === to).at(-1)!;

  beforeAll(async () => {
    assistant = new FakeAssistant();
    const model = new FakeVisionModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VisionModel)
      .useValue(model)
      .overrideProvider(Assistant)
      .useValue(assistant)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    db = app.get(getDrizzleToken());
    client = app.get(WhatsAppClient) as LogWhatsAppClient;
    await addTestUnits(app);

    const ps = await db.insert(parties).values(P.map((a) => ({ acronym: a, name: `Test ${a}` }))).returning();
    [{ id: electionId }] = await db
      .insert(elections)
      .values({
        type: 'local_government',
        title: 'E2E WhatsApp election',
        electionDate: '2026-11-01',
        scopeLevel: 'lga',
        scopeCode: '24-98',
        pollsCloseAt: new Date('2026-11-01T13:30:00Z'),
        status: 'active',
      })
      .returning({ id: elections.id });
    await db.insert(electionParties).values(ps.map((p, i) => ({ electionId, partyId: p.id, ballotOrder: i + 1 })));

    // One verified photo witness at 24-98-01-001: P0 100, P1 50
    const start = await request(app.getHttpServer()).post('/capture/start').send({ phone: '09091234567', consent: true }).expect(200);
    const up = await request(app.getHttpServer())
      .post(`/capture/photos?electionId=${electionId}&clientId=${randomUUID()}&unitCode=24-98-01-001`)
      .set('Authorization', `Bearer ${start.body.token}`)
      .set('X-Device-Id', randomUUID())
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]))
      .expect(201);
    model.next.push(poster(100, 50));
    await app.get(VerificationService).process(up.body.id);
  });

  afterAll(async () => {
    const contacts = await db.select({ id: whatsappContacts.id }).from(whatsappContacts);
    const ids = contacts.map((c) => c.id);
    if (ids.length) {
      await db.delete(whatsappMessages).where(inArray(whatsappMessages.contactId, ids));
      await db.delete(whatsappContacts).where(inArray(whatsappContacts.id, ids));
    }
    await db.delete(whatsappMessages);
    const reporterIds = (await db.select({ id: submissions.reporterId }).from(submissions).where(eq(submissions.electionId, electionId))).map((r) => r.id);
    await removeElection(app, electionId);
    const all = [...new Set(reporterIds)];
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

  it('verifies the webhook registration and refuses unsigned or wrongly signed calls', async () => {
    const ok = await request(app.getHttpServer())
      .get('/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-only-verify-token-123&hub.challenge=abc123')
      .expect(200);
    expect(ok.text).toBe('abc123');
    await request(app.getHttpServer()).get('/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc').expect(403);
    await request(app.getHttpServer()).post('/whatsapp/webhook').send({ entry: [] }).expect(403);
    await send(voter, { type: 'text', text: { body: 'hi' } }, { signature: 'sha256=00' }).then((r) => expect(r.status).toBe(403));
    expect(client.sent.filter((m) => m.to === voter)).toHaveLength(0);
  });

  it('answers emergencies at once, then asks for consent before anything else', async () => {
    await text(voter, 'Thugs are snatching the ballot box!');
    expect(last(voter).text).toMatch(/call 112/);
    await text(voter, '24-98-01-001');
    expect(last(voter)).toMatchObject({ kind: 'buttons', options: ['consent_yes', 'consent_no'] });
    await choose(voter, 'consent_yes');
    expect(last(voter).text).toMatch(/Send PHOTO/);
  });

  it('ignores a message Meta delivers twice', async () => {
    const before = client.sent.length;
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.dup.' + tag, from: voter, type: 'text', text: { body: 'help' } }] } }] }] });
    const sig = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer()).post('/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body).expect(200);
      await app.get(WhatsAppService).idle();
    }
    expect(client.sent.length).toBe(before + 1);
  });

  it('looks up a polling unit and a ward', async () => {
    await text(voter, '24-98-01-001');
    expect(last(voter).text).toMatch(new RegExp(`${P[0]} 100 · ${P[1]} 50`));
    expect(last(voter).text).toMatch(/1 independent witness/);
    // INF-02: "this unit" means the one just looked up, without asking the model
    assistant.next = null;
    await text(voter, 'is there any activity happening in this polling unit?');
    expect(last(voter).text).toMatch(new RegExp(`${P[0]} 100 · ${P[1]} 50`));
    await text(voter, 'ward 24-98-01');
    expect(last(voter).text).toMatch(/Counted from 1 of 2 polling units/);
  });

  it('records typed figures only as support for a photographed version (CAP-06, WIT-06)', async () => {
    await text(voter, `PU 24-98-01-001 ${P[0]} 100 ${P[1]} 50`);
    expect(last(voter).text).toMatch(/match a result photographed by 1 witness/);
    const [v] = await db.select().from(resultVersions).where(eq(resultVersions.electionId, electionId));
    expect(v.typedSupportCount).toBe(1);

    await text(voter, `PU 24-98-01-002 ${P[0]} 7 ${P[1]} 3`);
    expect(last(voter).text).toMatch(/never count on their own/);
    const versions = await db.select().from(resultVersions).where(eq(resultVersions.electionId, electionId));
    expect(versions).toHaveLength(1); // typed figures created no version

    await text(voter, `PU 24-98-01-001 ${P[0]} 100`);
    expect(last(voter).text).toMatch(new RegExp(`Missing: ${P[1]}`));
  });

  it('sends a one-time camera link instead of accepting WhatsApp photos (CAP-01, CAP-02)', async () => {
    await send(voter, { type: 'image', image: { id: 'media1' } });
    const link = /\/capture\?link=([\w-]+)/.exec(last(voter).text)?.[1];
    expect(link).toBeTruthy();
    const opened = await request(app.getHttpServer()).post('/capture/link').send({ token: link }).expect(200);
    await request(app.getHttpServer()).get('/capture/session').set('Authorization', `Bearer ${opened.body.token}`).expect(200);
    await request(app.getHttpServer()).post('/capture/link').send({ token: link }).expect(401); // once only
    // The link token itself is not a session
    await request(app.getHttpServer()).get('/capture/session').set('Authorization', `Bearer ${link}`).expect(401);
  });

  it('answers questions only from the knowledge base and in the voter\'s language', async () => {
    assistant.next = { intent: 'question', language: 'en', unit_code: null, area_code: null, answer: 'Bring your Permanent Voter Card (PVC).' };
    await text(voter, 'what do I need to vote?');
    expect(last(voter).text).toBe('Bring your Permanent Voter Card (PVC).');

    // INF-08: voting advice gets a fixed, neutral reply; the model only recognises the question
    assistant.next = { intent: 'voting_advice', language: 'en', unit_code: null, area_code: null, answer: null };
    await text(voter, 'who should I vote for?');
    expect(last(voter).text).toMatch(/does not give voting advice/);

    assistant.next = { intent: 'question', language: 'en', unit_code: null, area_code: null, answer: null };
    await text(voter, 'who are the candidates?');
    expect(last(voter).text).toMatch(/only answer from official INEC information/);

    // A Yoruba speaker gets translated replies; a translation that changes numbers is not used
    assistant.next = { intent: 'lookup', language: 'yo', unit_code: null, area_code: null, answer: null };
    await text(voter, 'Kini esi ni ibudo idibo mi?');
    // INF-02: the unit the voter last sent figures for; result text is never passed through the model
    expect(last(voter).text).toMatch(/^TEST UNIT TWO \(24-98-01-002\)/);
    assistant.next = { intent: 'greeting', language: 'yo', unit_code: null, area_code: null, answer: null };
    await text(voter, 'E kaaro');
    expect(last(voter).text).toMatch(/^\[yo\]/);
    assistant.translateWith = (t) => `[yo] ${t.replace('112', '911')}`;
    assistant.next = { intent: 'emergency', language: 'yo', unit_code: null, area_code: null, answer: null };
    await text(voter, 'Ewu wa nibi');
    expect(last(voter).text).toMatch(/call 112/);
    expect(last(voter).text).not.toMatch(/911/);
  });

  it('understands voice notes and answers them like typed messages (INF-05)', async () => {
    client.media.set('voice-1', { bytes: Buffer.from('OggS fake audio'), mimeType: 'audio/ogg; codecs=opus' });
    assistant.heard = { text: 'result for 24-98-01-001', language: 'en' };
    assistant.translateWith = (t) => t;
    const before = client.sent.filter((m) => m.to === voter).length;
    await send(voter, { type: 'audio', audio: { id: 'voice-1', mime_type: 'audio/ogg; codecs=opus' } });
    const replies = client.sent.filter((m) => m.to === voter).slice(before);
    expect(replies[0].text).toBe('🎙 “result for 24-98-01-001”');
    expect(replies[1].text).toMatch(new RegExp(`${P[0]} 100`));

    assistant.heard = null;
    await send(voter, { type: 'audio', audio: { id: 'voice-2' } });
    expect(last(voter).text).toMatch(/could not understand that voice note/);
  });

  it('only takes results from Nigerian numbers, and tracks delivery', async () => {
    await choose(foreign, 'consent_yes');
    await text(foreign, 'PHOTO');
    expect(last(foreign).text).toMatch(/only be sent from Nigerian mobile numbers/);

    const [out] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.direction, 'out'), eq(whatsappMessages.status, 'sent'))).limit(1);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: out.waMessageId, status: 'delivered' }] } }] }] });
    await request(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`)
      .send(body)
      .expect(200);
    const [after] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, out.id));
    expect(after.status).toBe('delivered');
    // No message text is stored
    expect(Object.keys(after)).not.toContain('body');
  });
});
