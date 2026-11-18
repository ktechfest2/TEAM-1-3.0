import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDrizzleToken } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { Database } from '../src/database/database.module.js';
import { adminSessions, adminUsers, auditLog } from '../src/database/schema.js';
import { totp } from '../src/security/totp.js';

/**
 * Full admin sign-in against the real database:
 * password -> set up authenticator -> confirm -> signed in -> logout -> second login with code.
 */
describe('Admin authentication (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const email = `e2e-${Date.now()}@trustelect.test`;
  const password = 'a sufficiently long passphrase';
  const origin = 'http://localhost:3000';

  const cookieFrom = (res: request.Response) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('te_admin='))!.split(';')[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(getDrizzleToken());
    await app.get(AuthService).createAdmin({ email, displayName: 'E2E Admin', role: 'reviewer', password });
  });

  afterAll(async () => {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    if (admin) {
      await db.delete(adminSessions).where(eq(adminSessions.adminUserId, admin.id));
      await db.delete(auditLog).where(eq(auditLog.adminUserId, admin.id));
      await db.delete(auditLog).where(eq(auditLog.targetId, admin.id));
      await db.delete(adminUsers).where(eq(adminUsers.id, admin.id));
    }
    await app.close();
  });

  it('rejects a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set('Origin', origin)
      .send({ email, password: 'wrong passphrase entirely' })
      .expect(401);
  });

  it('refuses admin routes without a session', async () => {
    await request(app.getHttpServer()).get('/admin/auth/me').expect(401);
  });

  it('walks through first sign-in, two-factor setup, logout and a second sign-in', async () => {
    const server = app.getHttpServer();

    // 1. Password accepted, two-factor setup required, pending session issued
    const login = await request(server)
      .post('/admin/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    expect(login.body).toEqual({ status: 'totp_setup_required' });
    const pending = cookieFrom(login);
    expect(login.headers['set-cookie']![0]).toMatch(/HttpOnly/i);
    expect(login.headers['set-cookie']![0]).toMatch(/SameSite=Strict/i);

    // A pending session cannot reach protected routes that need full sign-in
    const me = await request(server).get('/admin/auth/me').set('Cookie', pending).expect(200);
    expect(me.body.mfaVerified).toBe(false);

    // 2. Start setup: receive the secret for the authenticator app
    const setup = await request(server)
      .post('/admin/auth/totp/setup')
      .set('Cookie', pending)
      .set('Origin', origin)
      .expect(200);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\/TrustElect/);

    // A request from another site is refused
    await request(server)
      .post('/admin/auth/totp/confirm')
      .set('Cookie', pending)
      .set('Origin', 'https://evil.example')
      .send({ code: totp(setup.body.secret) })
      .expect(403);

    // 3. Confirm with a code: session upgraded
    await request(server)
      .post('/admin/auth/totp/confirm')
      .set('Cookie', pending)
      .set('Origin', origin)
      .send({ code: totp(setup.body.secret) })
      .expect(200);
    const signedIn = await request(server).get('/admin/auth/me').set('Cookie', pending).expect(200);
    expect(signedIn.body).toMatchObject({ email, role: 'reviewer', mfaVerified: true });

    // 4. Logout revokes the session
    await request(server).post('/admin/auth/logout').set('Cookie', pending).set('Origin', origin).expect(200);
    await request(server).get('/admin/auth/me').set('Cookie', pending).expect(401);

    // 5. Second sign-in needs the code; the code just used cannot be replayed
    const needsCode = await request(server)
      .post('/admin/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    expect(needsCode.body).toEqual({ status: 'totp_required' });

    await request(server)
      .post('/admin/auth/login')
      .set('Origin', origin)
      .send({ email, password, code: totp(setup.body.secret) })
      .expect(401);

    const nextCode = totp(setup.body.secret, Date.now() + 30_000);
    const second = await request(server)
      .post('/admin/auth/login')
      .set('Origin', origin)
      .send({ email, password, code: nextCode })
      .expect(200);
    expect(second.body).toEqual({ status: 'ok' });
    await request(server).get('/admin/auth/me').set('Cookie', cookieFrom(second)).expect(200);
  });
});
