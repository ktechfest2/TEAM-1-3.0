import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import { auditLog, knowledgeEntries } from '../src/database/schema.js';
import { KnowledgeService } from '../src/knowledge/knowledge.service.js';
import { ORIGIN, removeAdmins, signInNewAdmin } from './helpers.js';

describe('Assistant knowledge base (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let entrant: { cookie: string; email: string };
  let approver: { cookie: string; email: string };
  let reviewer: { cookie: string; email: string };
  const created: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    [entrant, approver, reviewer] = [
      await signInNewAdmin(app, 'declarations_admin'),
      await signInNewAdmin(app, 'approver'),
      await signInNewAdmin(app, 'reviewer'),
    ];
  });

  afterAll(async () => {
    if (created.length) {
      await db.delete(auditLog).where(inArray(auditLog.targetId, created));
      await db.delete(knowledgeEntries).where(inArray(knowledgeEntries.id, created));
    }
    await removeAdmins(app, [entrant.email, approver.email, reviewer.email]);
    await app.close();
  });

  const post = (path: string, who: { cookie: string }) => request(app.getHttpServer()).post(path).set('Cookie', who.cookie).set('Origin', ORIGIN);
  const fact = {
    topic: 'E2E early voting',
    fact: 'This is a test fact about voting that is long enough to be accepted.',
    sourceName: 'INEC press release',
    sourceUrl: 'https://inecnigeria.org/test-release',
  };

  it('starts with the initial approved facts', async () => {
    const facts = await app.get(KnowledgeService).approvedFacts();
    expect(facts.length).toBeGreaterThanOrEqual(10);
    expect(facts.map((f) => f.topic)).toContain('What to bring');
  });

  it('accepts official sources only, from the right roles', async () => {
    await post('/admin/knowledge', entrant).send({ ...fact, sourceUrl: 'https://someblog.example/news' }).expect(400);
    await post('/admin/knowledge', entrant).send({ ...fact, sourceUrl: 'http://inecnigeria.org/x' }).expect(400);
    await post('/admin/knowledge', reviewer).send(fact).expect(403);
    const res = await post('/admin/knowledge', entrant).send(fact).expect(201);
    created.push(res.body.id);
    expect(res.body.status).toBe('pending');
  });

  it('uses a fact only after a second administrator approves it', async () => {
    const service = app.get(KnowledgeService);
    const id = created[0];
    const topics = async () => {
      (service as unknown as { cache: null }).cache = null;
      return (await service.approvedFacts()).map((f) => f.topic);
    };
    expect(await topics()).not.toContain(fact.topic);
    await post(`/admin/knowledge/${id}/approve`, entrant).expect(403); // wrong role
    const approved = await post(`/admin/knowledge/${id}/approve`, approver).expect(200);
    expect(approved.body.status).toBe('approved');
    expect(await topics()).toContain(fact.topic);

    // Editing sends it back for approval; it stops being used meanwhile
    await post(`/admin/knowledge/${id}`, entrant).send({ ...fact, fact: `${fact.fact} Edited.` }).expect(200);
    expect(await topics()).not.toContain(fact.topic);
    await post(`/admin/knowledge/${id}/approve`, approver).expect(200);
    await post(`/admin/knowledge/${id}/retire`, approver).expect(200);
    expect(await topics()).not.toContain(fact.topic);

    const list = await request(app.getHttpServer()).get('/admin/knowledge').set('Cookie', reviewer.cookie).expect(200);
    expect(list.body.find((e: { id: string }) => e.id === id)).toMatchObject({ status: 'retired', enteredBy: expect.any(String) });
  });
});
