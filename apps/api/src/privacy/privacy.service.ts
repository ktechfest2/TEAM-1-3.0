import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import {
  adminSessions,
  adminUsers,
  captureLinks,
  captureSessions,
  rejectionLog,
  reporters,
  voterOtps,
  whatsappContacts,
  whatsappMessages,
} from '../database/schema.js';
import { Encryptor, keyedHash } from '../security/encryption.js';

const DAY = 86_400_000;
/** How long each kind of record is kept (privacy notice, NDPA 2023 data minimisation) */
export const RETENTION = {
  codesDays: 1,
  linksDays: 1,
  sessionsDays: 7,
  messageRecordsDays: 90,
  rejectionLogDays: 90,
  unfinishedConversationDays: 1,
} as const;

/** Data protection (Sprint 15): retention jobs, erasure on request, admin access review. */
@Injectable()
export class PrivacyService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Privacy');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly encryptor: Encryptor,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('RETENTION_WORKER', { infer: true }) !== 'on') return;
    const run = () => void this.runRetention().catch((err: Error) => this.logger.error(`retention failed: ${err.message}`));
    this.timer = setInterval(run, 6 * 3_600_000);
    setTimeout(run, 60_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes what is no longer needed; evidence and the audit log are kept */
  async runRetention(now = Date.now()) {
    const before = (days: number) => new Date(now - days * DAY);
    const deleted = {
      codes: (await this.db.delete(voterOtps).where(lt(voterOtps.createdAt, before(RETENTION.codesDays))).returning({ id: voterOtps.id })).length,
      links: (await this.db.delete(captureLinks).where(lt(captureLinks.expiresAt, before(RETENTION.linksDays))).returning({ id: captureLinks.id })).length,
      voterSessions: (await this.db.delete(captureSessions).where(lt(captureSessions.expiresAt, before(RETENTION.sessionsDays))).returning({ id: captureSessions.id })).length,
      adminSessions: (await this.db.delete(adminSessions).where(lt(adminSessions.expiresAt, before(RETENTION.sessionsDays))).returning({ id: adminSessions.id })).length,
      messageRecords: (await this.db.delete(whatsappMessages).where(lt(whatsappMessages.createdAt, before(RETENTION.messageRecordsDays))).returning({ id: whatsappMessages.id })).length,
      rejections: (await this.db.delete(rejectionLog).where(lt(rejectionLog.createdAt, before(RETENTION.rejectionLogDays))).returning({ id: rejectionLog.id })).length,
      unfinished: (
        await this.db
          .update(whatsappContacts)
          .set({ pendingFigures: null, pendingReport: null })
          .where(and(lt(whatsappContacts.lastInboundAt, before(RETENTION.unfinishedConversationDays)), or(isNotNull(whatsappContacts.pendingFigures), isNotNull(whatsappContacts.pendingReport))))
          .returning({ id: whatsappContacts.id })
      ).length,
    };
    if (Object.values(deleted).some((n) => n > 0)) {
      await this.audit.record({ adminUserId: null, action: 'retention.run', targetType: 'system', details: deleted });
      this.logger.log(`retention: ${JSON.stringify(deleted)}`);
    }
    return deleted;
  }

  /**
   * Erasure on request (privacy notice, NDPA 2023): the number is removed and unlinked;
   * evidence already used in results stays, anonymous, so the public record remains complete.
   */
  async erase(rawPhone: string, adminId: string) {
    const digits = rawPhone.replace(/\D/g, '');
    const e164 = digits.startsWith('0') && digits.length === 11 ? `+234${digits.slice(1)}` : `+${digits}`;
    if (!/^\+\d{10,15}$/.test(e164)) throw new BadRequestException('Enter the phone number in full, e.g. 0803 123 4567 or +234 803 123 4567');
    const hash = keyedHash(this.config.get('PHONE_HASH_KEY', { infer: true }), e164);

    const result = await this.db.transaction(async (tx) => {
      const [reporter] = await tx.select({ id: reporters.id }).from(reporters).where(eq(reporters.phoneHash, hash)).limit(1);
      const [contact] = await tx.select({ id: whatsappContacts.id }).from(whatsappContacts).where(eq(whatsappContacts.phoneHash, hash)).limit(1);
      await tx.delete(voterOtps).where(eq(voterOtps.phoneHash, hash));
      if (reporter) {
        await tx.delete(captureSessions).where(eq(captureSessions.reporterId, reporter.id));
        await tx.delete(captureLinks).where(eq(captureLinks.reporterId, reporter.id));
        await tx
          .update(reporters)
          .set({ phoneHash: `erased:${randomUUID()}`, phoneEncrypted: this.encryptor.encrypt('erased'), consentAt: null })
          .where(eq(reporters.id, reporter.id));
      }
      if (contact) {
        await tx.delete(whatsappMessages).where(eq(whatsappMessages.contactId, contact.id));
        await tx.delete(whatsappContacts).where(eq(whatsappContacts.id, contact.id));
      }
      return { reporter: reporter?.id ?? null, whatsapp: !!contact };
    });
    if (!result.reporter && !result.whatsapp) throw new NotFoundException('TrustElect holds no data for that number');
    // The number itself is never written to the audit log
    await this.audit.record({ adminUserId: adminId, action: 'privacy.erased', targetType: 'reporter', targetId: result.reporter, details: { whatsapp: result.whatsapp } });
    return { erased: true, evidenceKeptAnonymously: !!result.reporter };
  }

  /** Access review: every administrator, their role, second factor and last sign-in */
  async accessReview() {
    const rows = await this.db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        name: adminUsers.displayName,
        role: adminUsers.role,
        mfa: sql<boolean>`${adminUsers.totpEnabledAt} is not null`,
        disabledAt: adminUsers.disabledAt,
        createdAt: adminUsers.createdAt,
        lastSignIn: sql<Date | null>`(select max(${adminSessions.createdAt}) from ${adminSessions} where ${adminSessions.adminUserId} = ${adminUsers.id} and ${adminSessions.mfaVerified})`,
      })
      .from(adminUsers)
      .orderBy(isNull(adminUsers.disabledAt), desc(adminUsers.createdAt));
    return rows.map((r) => ({ ...r, lastSignIn: r.lastSignIn ? new Date(r.lastSignIn) : null }));
  }

  async setDisabled(id: string, disabled: boolean, reason: string, actorId: string) {
    if (id === actorId) throw new ForbiddenException('You cannot disable your own account');
    const [admin] = await this.db.select({ disabledAt: adminUsers.disabledAt }).from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    if (!admin) throw new NotFoundException('Administrator not found');
    if (!!admin.disabledAt === disabled) throw new ConflictException(disabled ? 'Already disabled' : 'Already active');
    await this.db.update(adminUsers).set({ disabledAt: disabled ? new Date() : null }).where(eq(adminUsers.id, id));
    if (disabled) await this.db.delete(adminSessions).where(eq(adminSessions.adminUserId, id));
    await this.audit.record({ adminUserId: actorId, action: disabled ? 'admin.disabled' : 'admin.enabled', targetType: 'admin_user', targetId: id, details: { reason } });
    return { id, disabled };
  }
}
