import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ChainService } from '../src/chain/chain.service.js';
import type { Database } from '../src/database/database.module.js';
import { auditLog, captureLinks, captureSessions, incidentReports, reporters, whatsappContacts, whatsappMessages } from '../src/database/schema.js';
import { IncidentAssessor } from '../src/incidents/assessor.js';
import { IncidentsService } from '../src/incidents/incidents.service.js';
import type { Assessment } from '../src/incidents/rules.js';
import { Assistant, type Understanding } from '../src/whatsapp/assistant.js';
import { LogWhatsAppClient, WhatsAppClient } from '../src/whatsapp/client.js';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service.js';
import { addTestUnits, ORIGIN, removeAdmins, removeTestUnits, signInNewAdmin } from './helpers.js';

const SECRET = 'test-only-whatsapp-app-secret';
const tag = Date.now().toString(36).toUpperCase().slice(-4);

class FakeAssessor extends IncidentAssessor {
  next: Assessment | null = null;
  async assess() {
    return this.next;
  }
}
class QuietAssistant extends Assistant {
  async compose(): Promise<string | null> {
    return null;
  }
  async understand(): Promise<Understanding> {
    return { intent: 'other', language: 'en', unit_code: null, area_code: null, answer: null };
  }
  async translate(t: string) {
    return t;
  }
  async transcribe() {
    return null;
  }
}

const seen = (shows: Assessment['shows_claim']): Assessment => ({
  shows_claim: shows,
  signs_of_editing: false,
  screenshot_or_forwarded: false,
  identifies_private_person: false,
  description: 'Test photo',
});
const photo = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]);

describe('Incident reports (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let assessor: FakeAssessor;
  let reviewer: { cookie: string; email: string };
  const reporterIds: string[] = [];

  const voter = async () => {
    const phone = `0908${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const res = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
    return res.body.token as string;
  };
  const report = async (token: string, q: Record<string, string>, body: Buffer = photo()) => {
    const params = new URLSearchParams({ clientId: randomUUID(), unitCode: '24-98-01-001', claim: 'The officials have not arrived at 10am.', type: 'late_officials', ...q });
    const res = await request(app.getHttpServer()).post(`/incidents?${params}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'image/jpeg').send(body);
    await app.get(IncidentsService).idle();
    return res;
  };
  const label = async (ref: string) => (await request(app.getHttpServer()).get(`/incidents/ref/${ref}`).expect(200)).body;

  beforeAll(async () => {
    assessor = new FakeAssessor();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IncidentAssessor)
      .useValue(assessor)
      .overrideProvider(Assistant)
      .useValue(new QuietAssistant())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    db = app.get(getDrizzleToken());
    await addTestUnits(app);
    reviewer = await signInNewAdmin(app, 'reviewer');
  });

  afterAll(async () => {
    const reports = await db.select({ id: incidentReports.id, reporterId: incidentReports.reporterId }).from(incidentReports);
    reporterIds.push(...reports.map((r) => r.reporterId));
    if (reports.length) {
      await db.delete(auditLog).where(inArray(auditLog.targetId, reports.map((r) => r.id)));
      await db.delete(incidentReports).where(inArray(incidentReports.id, reports.map((r) => r.id)));
    }
    await db.delete(whatsappMessages);
    await db.delete(whatsappContacts);
    const ids = [...new Set([...reporterIds, ...(await db.select({ id: captureSessions.reporterId }).from(captureSessions)).map((r) => r.id)])];
    if (ids.length) {
      await db.delete(captureLinks).where(inArray(captureLinks.reporterId, ids));
      await db.delete(captureSessions).where(inArray(captureSessions.reporterId, ids));
      await db.delete(reporters).where(inArray(reporters.id, ids));
    }
    await removeAdmins(app, [reviewer.email]);
    await removeTestUnits(app);
    await rm(process.env.EVIDENCE_DIR!, { recursive: true, force: true });
    await app.close();
  });

  it('accepts a web report with a live photo and publishes a low-risk one with its label', async () => {
    assessor.next = seen('yes');
    const res = await report(await voter(), {});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ reference: expect.stringMatching(/^TE-[A-Z2-9]{6}$/), emergency: false });
    expect(await label(res.body.reference)).toMatchObject({ label: 'supported', labelText: 'Supported by evidence', published: true });

    const list = (await request(app.getHttpServer()).get('/incidents?code=24-98').expect(200)).body;
    const mine = list.find((r: { reference: string }) => r.reference === res.body.reference);
    expect(mine).toMatchObject({ type: 'late_officials', unitCode: '24-98-01-001', labelText: 'Supported by evidence' });
    // The sender is never shown (INC-06)
    expect(JSON.stringify(list)).not.toMatch(/reporter|phone|latitude/i);
  });

  it('validates reports and needs a capture session', async () => {
    const token = await voter();
    expect((await report(token, { unitCode: '99-99-99-999' })).status).toBe(400);
    expect((await report(token, { claim: 'short' })).status).toBe(400);
    expect((await report(token, { type: 'rigging' })).status).toBe(400);
    expect((await report(token, {}, Buffer.from('not an image'))).status).toBe(400);
    await request(app.getHttpServer()).post('/incidents?type=other').set('Content-Type', 'image/jpeg').send(photo()).expect(401);
  });

  it('holds serious reports for review whatever the AI says, with the emergency reply', async () => {
    assessor.next = seen('yes');
    const res = await report(await voter(), { type: 'ballot_snatching', claim: 'Men took the ballot box away at 2pm.' });
    expect(res.body.emergency).toBe(true);
    expect(await label(res.body.reference)).toMatchObject({ label: 'under_review', published: false });
    const list = (await request(app.getHttpServer()).get('/incidents?code=24-98').expect(200)).body;
    expect(list.find((r: { reference: string }) => r.reference === res.body.reference)).toBeUndefined();

    // A reviewer sees it, with its evidence, and decides
    const queue = (await request(app.getHttpServer()).get('/admin/incidents').set('Cookie', reviewer.cookie).expect(200)).body;
    const held = queue.find((r: { reference: string }) => r.reference === res.body.reference);
    expect(held).toMatchObject({ status: 'held', assessment: { suggestedLabel: 'supported' } });
    await request(app.getHttpServer()).get(`/admin/incidents/${held.id}/evidence`).set('Cookie', reviewer.cookie).expect(200);
    await request(app.getHttpServer())
      .post(`/admin/incidents/${held.id}/review`)
      .set('Cookie', reviewer.cookie)
      .set('Origin', ORIGIN)
      .send({ label: 'partly_supported', publish: true, note: 'Photo shows a crowd near the box; snatching not visible.' })
      .expect(200);
    expect(await label(res.body.reference)).toMatchObject({ label: 'partly_supported', published: true });
  });

  it('marks a reused image as not supported', async () => {
    assessor.next = seen('yes');
    const image = photo();
    await report(await voter(), { unitCode: '24-98-01-002' }, image);
    const copy = await report(await voter(), { unitCode: '24-98-01-002' }, image);
    expect((await label(copy.body.reference)).label).toBe('not_supported');
  });

  it('raises the label when independent people report the same thing', async () => {
    assessor.next = seen('unclear');
    const refs: string[] = [];
    for (let i = 0; i < 3; i++) refs.push((await report(await voter(), { unitCode: '24-98-02-001', type: 'bvas_problem', claim: 'The BVAS machine is not reading fingerprints.' })).body.reference);
    // Each has two independent others: unclear evidence becomes partly supported
    for (const ref of refs) expect((await label(ref)).label).toBe('partly_supported');
  });

  it('takes reports on WhatsApp step by step and lets the sender follow the label', async () => {
    assessor.next = seen('yes');
    const client = app.get(WhatsAppClient) as LogWhatsAppClient;
    const from = `23490${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    let n = 0;
    const send = async (message: Record<string, unknown>) => {
      const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.inc.${tag}.${++n}`, from, ...message }] } }] }] });
      await request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`)
        .send(body)
        .expect(200);
      await app.get(WhatsAppService).idle();
      await app.get(IncidentsService).idle();
      return client.sent.filter((m) => m.to === from).at(-1)!;
    };
    await send({ type: 'interactive', interactive: { button_reply: { id: 'consent_yes' } } });
    expect(await send({ type: 'text', text: { body: 'REPORT' } })).toMatchObject({ kind: 'list', options: expect.arrayContaining(['report:missing_ec60e']) });
    expect((await send({ type: 'interactive', interactive: { list_reply: { id: 'report:missing_ec60e' } } })).text).toMatch(/what happened/);
    expect((await send({ type: 'text', text: { body: 'No result poster was pasted at 24-98-01-001 after counting.' } })).text).toMatch(/send a photo/);
    client.media.set('img-1', { bytes: photo(), mimeType: 'image/jpeg' });
    const receipt = (await send({ type: 'image', image: { id: 'img-1' } })).text;
    const ref = /TE-[A-Z2-9]{6}/.exec(receipt)![0];
    // WhatsApp evidence counts for less: supported only with corroboration (INC-02)
    expect((await label(ref)).label).toBe('partly_supported');
    expect((await send({ type: 'text', text: { body: ref } })).text).toMatch(new RegExp(`${ref} \\(Missing EC60E poster, 24-98-01-001\\): Partly supported`));
  });

  it('chains every report without the sender', async () => {
    const [r] = await db.select({ id: incidentReports.id }).from(incidentReports).limit(1);
    const history = await app.get(ChainService).history('incident', [r.id]);
    expect(history.length).toBeGreaterThan(0);
    expect(history.at(-1)!.payload).not.toMatch(/reporter|latitude|longitude/);
    const rows = await db.select().from(incidentReports).where(eq(incidentReports.id, r.id));
    expect(rows[0].reporterId).toBeTruthy();
  });
});
