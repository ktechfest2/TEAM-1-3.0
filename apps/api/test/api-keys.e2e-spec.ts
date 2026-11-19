import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ApiKeysService } from '../src/api-access/api-keys.service.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import { apiClients } from '../src/database/schema.js';
import { ORIGIN, removeAdmins, signInNewAdmin } from './helpers.js';

const registration = {
  organisation: 'E2E Newsroom',
  contactName: 'Test Editor',
  email: 'data-desk@newsroom.test',
  website: 'https://newsroom.test',
  purpose: 'Show citizen-collated results beside official declarations in our live election coverage.',
  acceptTerms: true,
};

describe('API keys for outside organisations (e2e)', () => {
  let app: INestApplication<App>;
  const admins: string[] = [];
  const clientIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    app.get(ApiKeysService).required = true;
  });

  afterAll(async () => {
    const db = app.get<Database>(getDrizzleToken());
    if (clientIds.length) await db.delete(apiClients).where(inArray(apiClients.id, clientIds));
    await removeAdmins(app, admins);
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('refuses public data to outside callers without a key, pointing to registration', async () => {
    const res = await request(server()).get('/geo/summary').expect(401);
    expect(res.body.message).toContain('/developers');
  });

  it('serves the TrustElect web app without a key (origin, or referrer for downloads)', async () => {
    await request(server()).get('/geo/summary').set('Origin', ORIGIN).expect(200);
    await request(server()).get('/geo/summary').set('Referer', `${ORIGIN}/results`).expect(200);
    await request(server()).get('/geo/summary').set('Origin', 'https://elsewhere.test').expect(401);
    await request(server()).get('/geo/summary').set('Referer', `${ORIGIN}.elsewhere.test/`).expect(401);
  });

  it('leaves health checks open', async () => {
    await request(server()).get('/health/live').expect(200);
  });

  it('requires accepting the terms to register', async () => {
    await request(server()).post('/developers/register').send({ ...registration, acceptTerms: false }).expect(400);
  });

  it('issues a key that works only once approved, and stops working when revoked', async () => {
    const reg = await request(server()).post('/developers/register').set('Origin', ORIGIN).send(registration).expect(201);
    expect(reg.body).toMatchObject({ status: 'pending', key: expect.stringMatching(/^te_live_[\w-]{43}$/) });
    expect(reg.body.key.startsWith(reg.body.keyPrefix)).toBe(true);
    clientIds.push(reg.body.id);
    const key: string = reg.body.key;

    // Only the hash is stored
    const db = app.get<Database>(getDrizzleToken());
    const [row] = await db.select().from(apiClients).where(inArray(apiClients.id, [reg.body.id]));
    expect(JSON.stringify(row)).not.toContain(key);

    const pending = await request(server()).get('/geo/summary').set('X-API-Key', key).expect(403);
    expect(pending.body.message).toContain('waiting for approval');

    // Reviewers cannot manage keys; system administrators can
    const reviewer = await signInNewAdmin(app, 'reviewer');
    admins.push(reviewer.email);
    await request(server()).get('/admin/api-clients').set('Cookie', reviewer.cookie).expect(403);

    const sys = await signInNewAdmin(app, 'system_admin');
    admins.push(sys.email);
    const list = await request(server()).get('/admin/api-clients').set('Cookie', sys.cookie).expect(200);
    const listed = list.body.find((c: { id: string }) => c.id === reg.body.id);
    expect(listed).toMatchObject({ organisation: 'E2E Newsroom', status: 'pending' });
    expect(listed.keyHash).toBeUndefined();

    await request(server()).post(`/admin/api-clients/${reg.body.id}/approve`).set('Cookie', sys.cookie).set('Origin', ORIGIN).send({}).expect(200);
    await request(server()).get('/geo/summary').set('X-API-Key', key).expect(200);
    await request(server()).get('/elections').set('X-API-Key', key).expect(200);

    await app.get(ApiKeysService).flush();
    const [used] = await db.select().from(apiClients).where(inArray(apiClients.id, [reg.body.id]));
    expect(used.requestCount).toBe(2);
    expect(used.lastUsedAt).toBeInstanceOf(Date);

    await request(server())
      .post(`/admin/api-clients/${reg.body.id}/revoke`)
      .set('Cookie', sys.cookie)
      .set('Origin', ORIGIN)
      .send({ note: 'Integration ended' })
      .expect(200);
    await request(server()).get('/geo/summary').set('X-API-Key', key).expect(401);
  });

  it('rejects unknown keys', async () => {
    await request(server()).get('/geo/summary').set('X-API-Key', 'te_live_not-a-real-key').expect(401);
  });
});
