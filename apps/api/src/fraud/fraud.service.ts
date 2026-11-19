import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { maskPhone } from '../capture/phone.js';
import type { Database } from '../database/database.module.js';
import { captureSessions, elections, pollingUnits, rejectionLog, reporters, submissions, unitResults } from '../database/schema.js';
import { Encryptor } from '../security/encryption.js';
import { samePicturePairs, type AcceptedPhoto } from '../witnesses/engine.js';
import { WitnessService } from '../witnesses/witness.service.js';

/** Rejected photos in a day from one number before it is suggested for blocking */
export const REJECTIONS_TO_SUGGEST_BLOCK = 3;

type Number_ = { reporterId: string; phone: string; blocked: boolean };

/**
 * Anti-fraud (Sprint 13): suspicious clusters for reviewers (ADM-02) and blocking of numbers
 * that keep sending fakes (ADM-03). Phone numbers are always shown masked.
 */
@Injectable()
export class FraudService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly encryptor: Encryptor,
    private readonly witnesses: WitnessService,
    private readonly audit: AuditService,
  ) {}

  private async numbers(ids: string[]): Promise<Number_[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: reporters.id, phone: reporters.phoneEncrypted, blockedAt: reporters.blockedAt })
      .from(reporters)
      .where(inArray(reporters.id, ids));
    return rows.map((r) => ({ reporterId: r.id, phone: maskPhone(this.encryptor.decrypt(r.phone)), blocked: !!r.blockedAt }));
  }

  /** Clusters a reviewer should look at, most recent activity first */
  async clusters() {
    // One device behind several numbers (merged into one witness already; repeated SIM swapping is abuse)
    const devices = await this.db
      .select({ deviceHash: submissions.deviceHash, numbers: sql<string[]>`array_agg(distinct ${submissions.reporterId})`, photos: sql<number>`count(*)::int`, last: sql<Date>`max(${submissions.receivedAt})` })
      .from(submissions)
      .where(isNotNull(submissions.deviceHash))
      .groupBy(submissions.deviceHash)
      .having(sql`count(distinct ${submissions.reporterId}) >= 2`)
      .orderBy(desc(sql`max(${submissions.receivedAt})`))
      .limit(50);

    // The same picture from several numbers, per polling unit
    const located = await this.db
      .select({
        submissionId: submissions.id,
        reporterId: submissions.reporterId,
        imageSha256: submissions.imageSha256,
        imageDhash: submissions.imageDhash,
        unitCode: pollingUnits.code,
        electionTitle: elections.title,
      })
      .from(submissions)
      .innerJoin(pollingUnits, eq(pollingUnits.id, submissions.pollingUnitId))
      .innerJoin(elections, eq(elections.id, submissions.electionId))
      .where(and(eq(submissions.kind, 'photo'), isNotNull(submissions.imageSha256), gt(submissions.receivedAt, new Date(Date.now() - 14 * 86_400_000))));
    const byUnit = new Map<string, typeof located>();
    for (const p of located) byUnit.set(`${p.unitCode}|${p.electionTitle}`, [...(byUnit.get(`${p.unitCode}|${p.electionTitle}`) ?? []), p]);
    const pictures: { unitCode: string; electionTitle: string; numbers: string[] }[] = [];
    for (const [key, group] of byUnit) {
      const pairs = samePicturePairs(group.map((g) => ({ ...g, deviceHash: null, ipHash: null, figures: { partyVotes: {}, totalValid: 0, rejected: null, totalCast: null }, strength: 'standard' }) as AcceptedPhoto));
      if (!pairs.length) continue;
      const [unitCode, electionTitle] = key.split('|');
      pictures.push({ unitCode, electionTitle, numbers: [...new Set(pairs.flatMap(([a, b]) => [a.reporterId, b.reporterId]))] });
    }

    // Units the witness engine flagged
    const flagged = await this.db
      .select({ unitCode: pollingUnits.code, electionId: unitResults.electionId, electionTitle: elections.title, flags: unitResults.flags, status: unitResults.status, updatedAt: unitResults.updatedAt })
      .from(unitResults)
      .innerJoin(pollingUnits, eq(pollingUnits.id, unitResults.pollingUnitId))
      .innerJoin(elections, eq(elections.id, unitResults.electionId))
      .where(sql`${unitResults.flags} ?| array['burst','out_of_area','same_picture_several_numbers','shared_network']`)
      .orderBy(desc(unitResults.updatedAt))
      .limit(100);

    // Numbers whose photos keep being rejected (not genuine EC60Es, wrong election, …)
    const rejected = await this.db
      .select({ reporterId: rejectionLog.reporterId, rejections: sql<number>`count(*)::int`, reasons: sql<string[]>`array_agg(distinct ${rejectionLog.reason})` })
      .from(rejectionLog)
      .where(gt(rejectionLog.createdAt, new Date(Date.now() - 86_400_000)))
      .groupBy(rejectionLog.reporterId)
      .having(sql`count(*) >= ${REJECTIONS_TO_SUGGEST_BLOCK}`)
      .orderBy(desc(sql`count(*)`))
      .limit(50);

    const ids = [...new Set([...devices.flatMap((d) => d.numbers), ...pictures.flatMap((p) => p.numbers), ...rejected.map((r) => r.reporterId)])];
    const lookup = new Map((await this.numbers(ids)).map((n) => [n.reporterId, n]));
    const show = (list: string[]) => list.map((id) => lookup.get(id)!).filter(Boolean);
    return {
      sharedDevices: devices.map((d) => ({ photos: d.photos, last: d.last, numbers: show(d.numbers) })),
      samePicture: pictures.map((p) => ({ ...p, numbers: show(p.numbers) })),
      flaggedUnits: flagged,
      repeatedRejections: rejected.map((r) => ({ rejections: r.rejections, reasons: r.reasons, number: lookup.get(r.reporterId)! })),
    };
  }

  /** ADM-03: a blocked number is refused on every channel and its evidence stops counting */
  async block(reporterId: string, reason: string, adminId: string) {
    const [r] = await this.db.select().from(reporters).where(eq(reporters.id, reporterId)).limit(1);
    if (!r) throw new NotFoundException('Number not found');
    if (r.blockedAt) throw new ConflictException('This number is already blocked');
    await this.db.update(reporters).set({ blockedAt: new Date(), blockReason: reason, blockedBy: adminId }).where(eq(reporters.id, reporterId));
    await this.db.update(captureSessions).set({ expiresAt: new Date() }).where(and(eq(captureSessions.reporterId, reporterId), gt(captureSessions.expiresAt, new Date())));
    await this.audit.record({ adminUserId: adminId, action: 'reporter.blocked', targetType: 'reporter', targetId: reporterId, details: { reason } });
    return { units: await this.recalculate(reporterId) };
  }

  async unblock(reporterId: string, reason: string, adminId: string) {
    const [r] = await this.db.select().from(reporters).where(eq(reporters.id, reporterId)).limit(1);
    if (!r) throw new NotFoundException('Number not found');
    if (!r.blockedAt) throw new ConflictException('This number is not blocked');
    await this.db.update(reporters).set({ blockedAt: null, blockReason: null, blockedBy: null }).where(eq(reporters.id, reporterId));
    await this.audit.record({ adminUserId: adminId, action: 'reporter.unblocked', targetType: 'reporter', targetId: reporterId, details: { reason } });
    return { units: await this.recalculate(reporterId) };
  }

  /** Every unit the number sent evidence for is worked out again */
  private async recalculate(reporterId: string) {
    const units = await this.db
      .selectDistinct({ electionId: submissions.electionId, pollingUnitId: submissions.pollingUnitId })
      .from(submissions)
      .where(and(eq(submissions.reporterId, reporterId), isNotNull(submissions.pollingUnitId)));
    for (const u of units) await this.witnesses.recalculate(u.electionId, u.pollingUnitId!);
    return units.length;
  }

  async blocked() {
    const rows = await this.db
      .select({ id: reporters.id, phone: reporters.phoneEncrypted, blockedAt: reporters.blockedAt, reason: reporters.blockReason })
      .from(reporters)
      .where(isNotNull(reporters.blockedAt))
      .orderBy(desc(reporters.blockedAt))
      .limit(200);
    return rows.map((r) => ({ reporterId: r.id, phone: maskPhone(this.encryptor.decrypt(r.phone)), blockedAt: r.blockedAt, reason: r.reason }));
  }
}
