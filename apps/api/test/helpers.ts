import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthService, type AdminRole } from '../src/auth/auth.service.js';
import type { Database } from '../src/database/database.module.js';
import {
  adminSessions,
  adminUsers,
  auditLog,
  declarations,
  electionParties,
  elections,
  lgas,
  pollingUnits,
  rejectionLog,
  resultVersions,
  submissions,
  unitResults,
  wards,
} from '../src/database/schema.js';
import { GeographyService } from '../src/geography/geography.service.js';
import { parseRegister } from '../src/geography/register.js';
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

/** Fictional polling units for tests: LGA 98 does not exist in Lagos (24) or Kano (19). */
export const TEST_UNIT = '24-98-01-001';
export const TEST_UNIT_OUTSIDE_LAGOS = '19-98-01-001';

export async function addTestUnits(app: INestApplication<App>) {
  const { rows } = parseRegister(
    'pu_code,pu_name,ward_name,lga_name,state_name\n' +
      `${TEST_UNIT},TEST UNIT,TEST WARD,TEST LGA,Lagos\n` +
      '24-98-01-002,TEST UNIT TWO,TEST WARD,TEST LGA,Lagos\n' +
      '24-98-02-001,TEST UNIT THREE,TEST WARD TWO,TEST LGA,Lagos\n' +
      `${TEST_UNIT_OUTSIDE_LAGOS},TEST UNIT KANO,TEST WARD,TEST LGA,Kano\n`,
  );
  await app.get(GeographyService).importRegister(rows);
}

/** Removes an election and everything recorded for it, in foreign-key order. */
export async function removeElection(app: INestApplication<App>, electionId: string) {
  const db = app.get<Database>(getDrizzleToken());
  await db.delete(unitResults).where(eq(unitResults.electionId, electionId));
  await db.update(submissions).set({ versionId: null }).where(eq(submissions.electionId, electionId));
  await db.delete(resultVersions).where(eq(resultVersions.electionId, electionId));
  await db.delete(submissions).where(eq(submissions.electionId, electionId));
  await db.delete(rejectionLog).where(eq(rejectionLog.electionId, electionId));
  await db.delete(auditLog).where(like(auditLog.targetId, `${electionId}%`));
  await db.delete(declarations).where(eq(declarations.electionId, electionId));
  await db.delete(electionParties).where(eq(electionParties.electionId, electionId));
  await db.delete(elections).where(eq(elections.id, electionId));
}

export async function removeTestUnits(app: INestApplication<App>) {
  const db = app.get<Database>(getDrizzleToken());
  for (const prefix of ['24-98', '19-98']) {
    const ids = (await db.select({ id: pollingUnits.id }).from(pollingUnits).where(like(pollingUnits.code, `${prefix}-%`))).map((u) => u.id);
    if (ids.length) {
      await db.delete(unitResults).where(inArray(unitResults.pollingUnitId, ids));
      await db.update(submissions).set({ versionId: null }).where(inArray(submissions.pollingUnitId, ids));
      await db.delete(resultVersions).where(inArray(resultVersions.pollingUnitId, ids));
      await db.update(submissions).set({ pollingUnitId: null }).where(inArray(submissions.pollingUnitId, ids));
    }
    await db.delete(pollingUnits).where(like(pollingUnits.code, `${prefix}-%`));
    await db.delete(wards).where(like(wards.code, `${prefix}-%`));
    await db.delete(lgas).where(eq(lgas.code, prefix));
  }
}
