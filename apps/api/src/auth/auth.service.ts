import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { adminSessions, adminUsers } from '../database/schema.js';
import { Encryptor, newToken, sha256 } from '../security/encryption.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../security/totp.js';

export type AdminRole = (typeof adminUsers.$inferSelect)['role'];

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  sessionId: string;
  mfaVerified: boolean;
}

export type LoginOutcome =
  | { status: 'ok'; token: string }
  | { status: 'totp_setup_required'; token: string }
  | { status: 'totp_required' }
  | { status: 'invalid' }
  | { status: 'locked' };

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** A session that has passed the password but not yet the second factor */
const PENDING_SESSION_MINUTES = 10;

/** Used so that unknown emails take as long as known ones */
const DUMMY_HASH = await hashPassword('timing-equaliser-not-a-real-password');

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly encryptor: Encryptor,
    private readonly audit: AuditService,
  ) {}

  /** Creates an administrator (used by the create-admin command). */
  async createAdmin(input: { email: string; displayName: string; role: AdminRole; password: string }) {
    const [admin] = await this.db
      .insert(adminUsers)
      .values({
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName.trim(),
        role: input.role,
        passwordHash: await hashPassword(input.password),
      })
      .returning({ id: adminUsers.id, email: adminUsers.email });
    await this.audit.record({ adminUserId: null, action: 'admin.created', targetType: 'admin_user', targetId: admin.id, details: { role: input.role } });
    return admin;
  }

  async login(email: string, password: string, code: string | undefined, ctx: RequestContext): Promise<LoginOutcome> {
    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email.trim().toLowerCase()))
      .limit(1);

    if (!admin) {
      await verifyPassword(password, DUMMY_HASH);
      return { status: 'invalid' };
    }
    if (admin.disabledAt) return { status: 'invalid' };
    if (admin.lockedUntil && admin.lockedUntil > new Date()) return { status: 'locked' };

    if (!(await verifyPassword(password, admin.passwordHash))) {
      await this.recordFailure(admin.id, admin.failedLogins, 'password');
      return { status: 'invalid' };
    }

    // Password correct. First login: the administrator must set up two-factor authentication.
    if (!admin.totpEnabledAt || !admin.totpSecretEncrypted) {
      const token = await this.createSession(admin.id, false, PENDING_SESSION_MINUTES, ctx);
      await this.audit.record({ adminUserId: admin.id, action: 'auth.password_ok_totp_setup_required', targetType: 'admin_user', targetId: admin.id });
      return { status: 'totp_setup_required', token };
    }

    if (!code) return { status: 'totp_required' };

    const step = verifyTotp(this.encryptor.decrypt(admin.totpSecretEncrypted), code);
    if (step === null || (admin.totpLastStep !== null && step <= admin.totpLastStep)) {
      await this.recordFailure(admin.id, admin.failedLogins, 'totp');
      return { status: 'invalid' };
    }

    await this.db
      .update(adminUsers)
      .set({ failedLogins: 0, lockedUntil: null, totpLastStep: step })
      .where(eq(adminUsers.id, admin.id));
    const token = await this.createSession(admin.id, true, this.sessionMinutes(), ctx);
    await this.audit.record({ adminUserId: admin.id, action: 'auth.login', targetType: 'admin_user', targetId: admin.id, details: { ip: ctx.ip } });
    return { status: 'ok', token };
  }

  /** Starts two-factor setup for a pending session: returns a new secret for the authenticator app. */
  async beginTotpSetup(admin: AuthenticatedAdmin): Promise<{ secret: string; uri: string }> {
    // Reuse an unconfirmed secret, so reloading the setup page shows the same QR code
    const [row] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, admin.id)).limit(1);
    if (row?.totpSecretEncrypted && !row.totpEnabledAt) {
      const existing = this.encryptor.decrypt(row.totpSecretEncrypted);
      return { secret: existing, uri: totpUri(existing, admin.email) };
    }
    const secret = generateTotpSecret();
    await this.db
      .update(adminUsers)
      .set({ totpSecretEncrypted: this.encryptor.encrypt(secret), totpEnabledAt: null })
      .where(and(eq(adminUsers.id, admin.id), isNull(adminUsers.totpEnabledAt)));
    return { secret, uri: totpUri(secret, admin.email) };
  }

  /** Confirms the authenticator app with a first code and upgrades the session. */
  async confirmTotpSetup(admin: AuthenticatedAdmin, code: string): Promise<boolean> {
    const [row] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, admin.id)).limit(1);
    if (!row?.totpSecretEncrypted || row.totpEnabledAt) return false;

    const step = verifyTotp(this.encryptor.decrypt(row.totpSecretEncrypted), code);
    if (step === null) return false;

    await this.db
      .update(adminUsers)
      .set({ totpEnabledAt: new Date(), totpLastStep: step, failedLogins: 0, lockedUntil: null })
      .where(eq(adminUsers.id, admin.id));
    await this.db
      .update(adminSessions)
      .set({ mfaVerified: true, expiresAt: this.expiry(this.sessionMinutes()) })
      .where(eq(adminSessions.id, admin.sessionId));
    await this.audit.record({ adminUserId: admin.id, action: 'auth.totp_enabled', targetType: 'admin_user', targetId: admin.id });
    return true;
  }

  /** Resolves a session token to the administrator, or null if invalid or expired. */
  async resolveSession(token: string): Promise<AuthenticatedAdmin | null> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: adminSessions.id,
        mfaVerified: adminSessions.mfaVerified,
        id: adminUsers.id,
        email: adminUsers.email,
        displayName: adminUsers.displayName,
        role: adminUsers.role,
        disabledAt: adminUsers.disabledAt,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
      .where(
        and(
          eq(adminSessions.tokenHash, sha256(token)),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row || row.disabledAt) return null;
    await this.db.update(adminSessions).set({ lastSeenAt: now }).where(eq(adminSessions.id, row.sessionId));
    const { disabledAt: _disabled, ...admin } = row;
    return admin;
  }

  async logout(admin: AuthenticatedAdmin): Promise<void> {
    await this.db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, admin.sessionId));
    await this.audit.record({ adminUserId: admin.id, action: 'auth.logout', targetType: 'admin_user', targetId: admin.id });
  }

  sessionMaxAgeSeconds(mfaVerified: boolean): number {
    return (mfaVerified ? this.sessionMinutes() : PENDING_SESSION_MINUTES) * 60;
  }

  private sessionMinutes(): number {
    return this.config.get('ADMIN_SESSION_HOURS', { infer: true }) * 60;
  }

  private expiry(minutes: number): Date {
    return new Date(Date.now() + minutes * 60_000);
  }

  private async createSession(adminUserId: string, mfaVerified: boolean, minutes: number, ctx: RequestContext) {
    const { token, hash } = newToken();
    await this.db.insert(adminSessions).values({
      adminUserId,
      tokenHash: hash,
      mfaVerified,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
      expiresAt: this.expiry(minutes),
    });
    return token;
  }

  private async recordFailure(adminUserId: string, previousFailures: number, reason: 'password' | 'totp') {
    const failures = previousFailures + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await this.db
      .update(adminUsers)
      .set({
        failedLogins: lock ? 0 : failures,
        lockedUntil: lock ? this.expiry(LOCK_MINUTES) : null,
      })
      .where(eq(adminUsers.id, adminUserId));
    await this.audit.record({
      adminUserId,
      action: lock ? 'auth.locked' : 'auth.failed',
      targetType: 'admin_user',
      targetId: adminUserId,
      details: { reason },
    });
  }
}
