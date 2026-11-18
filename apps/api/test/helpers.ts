import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthService, type AdminRole } from '../src/auth/auth.service.js';
import type { Database } from '../src/database/database.module.js';
import { adminSessions, adminUsers, auditLog } from '../src/database/schema.js';
import { totp } from '../src/security/totp.js';

export const ORIGIN = 'http://localhost:3000';

/** Creates an admin and completes first sign-in with two-factor setup. Returns the session cookie. */
export async function signInNewAdmin(app: INestApplication<App>, role: AdminRole): Promise<{ cookie: string; email: string }> {
  const email = `e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trustelect.test`;
  const password = 'a sufficiently long passphrase';
  await app.get(AuthService).createAdmin({ email, displayName: `E2E ${role}`, role, password });

  const server = app.getHttpServer();
  const login = await request(server).post('/admin/auth/login').set('Origin', ORIGIN).send({ email, password }).expect(200);
  const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? [])[0].split(';')[0];
  const setup = await request(server).post('/admin/auth/totp/setup').set('Cookie', cookie).set('Origin', ORIGIN).expect(200);
  await request(server)
    .post('/admin/auth/totp/confirm')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .send({ code: totp(setup.body.secret) })
    .expect(200);
  return { cookie, email };
}

/** Removes test administrators with their sessions and audit entries. */
export async function removeAdmins(app: INestApplication<App>, emails: string[]) {
  if (!emails.length) return;
  const db = app.get<Database>(getDrizzleToken());
  const ids = (await db.select({ id: adminUsers.id }).from(adminUsers).where(inArray(adminUsers.email, emails))).map((r) => r.id);
  if (!ids.length) return;
  await db.delete(adminSessions).where(inArray(adminSessions.adminUserId, ids));
  await db.delete(auditLog).where(inArray(auditLog.adminUserId, ids));
  for (const id of ids) await db.delete(auditLog).where(eq(auditLog.targetId, id));
  await db.delete(adminUsers).where(inArray(adminUsers.id, ids));
}
