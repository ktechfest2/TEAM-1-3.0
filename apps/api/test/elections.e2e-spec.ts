import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import { auditLog, electionParties, elections, parties } from '../src/database/schema.js';
import { GeographyService } from '../src/geography/geography.service.js';
import { ORIGIN, removeAdmins, signInNewAdmin } from './helpers.js';

describe('Parties and elections (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let systemAdmin: { cookie: string; email: string };
  let reviewer: { cookie: string; email: string };
  const tag = Date.now().toString(36).toUpperCase().slice(-4);
  const acronyms = [`ZA${tag}`, `ZB${tag}`, `ZC${tag}`];
  const electionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    await app.get(GeographyService).seedStates();
    systemAdmin = await signInNewAdmin(app, 'system_admin');
    reviewer = await signInNewAdmin(app, 'reviewer');
  });

  afterAll(async () => {
    if (electionIds.length) {
      await db.delete(electionParties).where(inArray(electionParties.electionId, electionIds));
      await db.delete(auditLog).where(inArray(auditLog.targetId, electionIds));
      await db.delete(elections).where(inArray(elections.id, electionIds));
    }
    await db.delete(parties).where(inArray(parties.acronym, acronyms));
    await removeAdmins(app, [systemAdmin.email, reviewer.email]);
    await app.close();
  });

  const post = (path: string, cookie: string) =>
    request(app.getHttpServer()).post(path).set('Cookie', cookie).set('Origin', ORIGIN);

  it('lets a system administrator add parties, and refuses duplicates', async () => {
    for (const acronym of acronyms) {
      await post('/admin/parties', systemAdmin.cookie).send({ acronym, name: `Test Party ${acronym}` }).expect(201);
    }
    await post('/admin/parties', systemAdmin.cookie).send({ acronym: acronyms[0], name: 'Duplicate' }).expect(409);
  });

  it('refuses changes from a reviewer and from signed-out visitors', async () => {
    await post('/admin/parties', reviewer.cookie).send({ acronym: 'ZZ' + tag, name: 'Not allowed' }).expect(403);
    await request(app.getHttpServer()).get('/admin/parties').expect(401);
    await request(app.getHttpServer()).get('/admin/parties').set('Cookie', reviewer.cookie).expect(200);
  });

  it('validates elections', async () => {
    const base = {
      type: 'governorship',
      title: 'Test Governorship Election',
      electionDate: '2027-03-06',
      scopeLevel: 'state',
      scopeCode: '24',
      pollsCloseAt: '2027-03-06T14:30:00+01:00',
      partyAcronyms: acronyms,
    };
    await post('/admin/elections', systemAdmin.cookie).send({ ...base, scopeCode: undefined }).expect(400);
    await post('/admin/elections', systemAdmin.cookie).send({ ...base, scopeCode: '99' }).expect(400);
    await post('/admin/elections', systemAdmin.cookie).send({ ...base, pollsCloseAt: '2027-03-07T14:30:00+01:00' }).expect(400);
    await post('/admin/elections', systemAdmin.cookie).send({ ...base, partyAcronyms: [acronyms[0], acronyms[0]] }).expect(400);
    await post('/admin/elections', systemAdmin.cookie).send({ ...base, partyAcronyms: [...acronyms, 'NOPE'] }).expect(400);
  });

  it('creates an election with parties in alphabetical ballot order, hides the draft from the public, then publishes it', async () => {
    const created = await post('/admin/elections', systemAdmin.cookie)
      .send({
        type: 'governorship',
        title: `Test Lagos Governorship ${tag}`,
        electionDate: '2027-03-06',
        scopeLevel: 'state',
        scopeCode: '24',
        pollsCloseAt: '2027-03-06T14:30:00+01:00',
        partyAcronyms: [acronyms[2], acronyms[0], acronyms[1]],
      })
      .expect(201);
    const id = created.body.id as string;
    electionIds.push(id);
    expect(created.body.status).toBe('draft');
    // Submitted out of order; stored alphabetically by acronym
    expect(created.body.parties.map((p: { acronym: string }) => p.acronym)).toEqual([acronyms[0], acronyms[1], acronyms[2]]);
    expect(created.body.parties.map((p: { ballotOrder: number }) => p.ballotOrder)).toEqual([1, 2, 3]);

    // Draft is invisible publicly
    await request(app.getHttpServer()).get(`/elections/${id}`).expect(404);

    // Status moves forward only
    await post(`/admin/elections/${id}/status`, systemAdmin.cookie).send({ status: 'closed' }).expect(400);
    await post(`/admin/elections/${id}/status`, reviewer.cookie).send({ status: 'active' }).expect(403);
    await post(`/admin/elections/${id}/status`, systemAdmin.cookie).send({ status: 'active' }).expect(200);

    const pub = await request(app.getHttpServer()).get(`/elections/${id}`).expect(200);
    expect(pub.body.title).toBe(`Test Lagos Governorship ${tag}`);
    await post(`/admin/elections/${id}/status`, systemAdmin.cookie).send({ status: 'closed' }).expect(200);
    await post(`/admin/elections/${id}/status`, systemAdmin.cookie).send({ status: 'active' }).expect(400);
  });
});
