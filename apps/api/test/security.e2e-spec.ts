import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { eq, like } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Database } from '../src/database/database.module.js';
import { auditLog, captureSessions, reporters, voterOtps } from '../src/database/schema.js';
import { PrivacyService } from '../src/privacy/privacy.service.js';
import { ORIGIN, removeAdmins, signInNewAdmin } from './helpers.js';

describe('Security and data protection (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sysadmin: { cookie: string; email: string };
  let reviewer: { cookie: string; email: string };
  const phone = `0905${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same header middleware as main.ts
    const express = app.getHttpAdapter().getInstance();
    express.disable('x-powered-by');
    express.use((req: { path: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (req.path.startsWith('/admin')) res.setHeader('Cache-Control', 'no-store');
      next();
    });
    await app.init();
    db = app.get(getDrizzleToken());
    [sysadmin, reviewer] = [await signInNewAdmin(app, 'system_admin'), await signInNewAdmin(app, 'reviewer')];
  });

  afterAll(async () => {
    await db.delete(auditLog).where(like(auditLog.action, 'privacy.%'));
    await removeAdmins(app, [sysadmin.email, reviewer.email]);
    await app.close();
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('erases a number on request (system administrators only) and ends its sessions', async () => {
    const start = await request(app.getHttpServer()).post('/capture/start').send({ phone, consent: true }).expect(200);
    const post = (who: { cookie: string }) => request(app.getHttpServer()).post('/admin/privacy/erase').set('Cookie', who.cookie).set('Origin', ORIGIN).send({ phone });
    await post(reviewer).expect(403);
    expect((await post(sysadmin).expect(200)).body).toMatchObject({ erased: true });
    await request(app.getHttpServer()).get('/capture/session').set('Authorization', `Bearer ${start.body.token}`).expect(401);
    await post(sysadmin).expect(404);
  });

  it('erasure unlinks the number and never logs it', async () => {
    const privacy = app.get(PrivacyService);
    const other = `0904${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const capture = (await import('../src/capture/capture.service.js')).CaptureService;
    const reporterId = await app.get(capture).reporterFor(`+234${other.slice(1)}`);
    const [admin] = await db.select().from((await import('../src/database/schema.js')).adminUsers).limit(1);
    const res = await privacy.erase(other, admin.id);
    expect(res).toMatchObject({ erased: true, evidenceKeptAnonymously: true });
    const [r] = await db.select().from(reporters).where(eq(reporters.id, reporterId));
    expect(r.phoneHash).toMatch(/^erased:/);
    expect(r.consentAt).toBeNull();
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, 'privacy.erased'));
    expect(JSON.stringify(logs)).not.toContain(other.slice(1));
    await expect(privacy.erase(other, admin.id)).rejects.toThrow(/no data/);
    await db.delete(reporters).where(eq(reporters.id, reporterId));
  });

  it('deletes expired codes and sessions on the retention run', async () => {
    const capture = (await import('../src/capture/capture.service.js')).CaptureService;
    const reporterId = await app.get(capture).reporterFor(`+234${phone.slice(1)}9`.slice(0, 14));
    const old = new Date(Date.now() - 10 * 86_400_000);
    const [otp] = await db.insert(voterOtps).values({ phoneHash: 'retention-test', codeHash: 'x', expiresAt: old, createdAt: old }).returning();
    const [session] = await db.insert(captureSessions).values({ reporterId, tokenHash: `retention-${Date.now()}`, issuedVia: 'web', expiresAt: old }).returning();
    const deleted = await app.get(PrivacyService).runRetention();
    expect(deleted.codes).toBeGreaterThanOrEqual(1);
    expect(deleted.voterSessions).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(voterOtps).where(eq(voterOtps.id, otp.id))).toHaveLength(0);
    expect(await db.select().from(captureSessions).where(eq(captureSessions.id, session.id))).toHaveLength(0);
    await db.delete(reporters).where(eq(reporters.id, reporterId));
  });

  it('reviews access and disables an administrator at once', async () => {
    const privacy = app.get(PrivacyService);
    const list = await privacy.accessReview();
    const me = list.find((a) => a.email === sysadmin.email)!;
    const them = list.find((a) => a.email === reviewer.email)!;
    expect(me).toMatchObject({ mfa: true, lastSignIn: expect.any(Date) });
    await expect(privacy.setDisabled(me.id, true, 'testing self', me.id)).rejects.toThrow(/own account/);
    await privacy.setDisabled(them.id, true, 'Left the review team', me.id);
    await request(app.getHttpServer()).get('/admin/auth/me').set('Cookie', reviewer.cookie).expect((r) => expect([401, 429]).toContain(r.status));
    await privacy.setDisabled(them.id, false, 'Rejoined the review team', me.id);
  });

  // Last: it uses up this test app's allowance for the address
  it('limits every endpoint per network address', async () => {
    let limited = false;
    for (let i = 0; i < 320 && !limited; i++) {
      const res = await request(app.getHttpServer()).get('/results/elections');
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
  });
});
