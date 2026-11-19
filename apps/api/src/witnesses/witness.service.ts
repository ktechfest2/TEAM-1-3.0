import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { parseUnitCode } from '@trustelect/shared';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { ChainService } from '../chain/chain.service.js';
import type { Database } from '../database/database.module.js';
import { pollingUnits, reporters, resultVersions, submissions, unitResults } from '../database/schema.js';
import { RESULTS_CHANNEL } from '../tally/channel.js';
import { computeUnit, figuresHash, type AcceptedPhoto } from './engine.js';

@Injectable()
export class WitnessService {
  private readonly logger = new Logger('Witnesses');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly chain: ChainService,
  ) {}

  /**
   * Recomputes versions, witnesses, confidence and the counted version of one polling unit
   * (WIT-01 to WIT-07). Runs whenever a photo of the unit is accepted.
   */
  async recalculate(electionId: string, pollingUnitId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // One recalculation per unit at a time
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${electionId}:${pollingUnitId}`}))`);

      const rows = await tx
        .select({
          submissionId: submissions.id,
          reporterId: submissions.reporterId,
          deviceHash: submissions.deviceHash,
          ipHash: submissions.ipHash,
          figures: submissions.extracted,
          strength: submissions.evidenceStrength,
          imageSha256: submissions.imageSha256,
          imageDhash: submissions.imageDhash,
          receivedAt: submissions.receivedAt,
          latitude: submissions.latitude,
          longitude: submissions.longitude,
        })
        .from(submissions)
        .innerJoin(reporters, eq(reporters.id, submissions.reporterId))
        .where(
          and(
            eq(submissions.electionId, electionId),
            eq(submissions.pollingUnitId, pollingUnitId),
            eq(submissions.status, 'verified'),
            eq(submissions.kind, 'photo'),
            isNotNull(submissions.extracted),
            // ADM-03: blocked numbers no longer count
            isNull(reporters.blockedAt),
          ),
        );
      const photos: AcceptedPhoto[] = rows.map(({ latitude, longitude, receivedAt, ...r }) => ({
        ...r,
        figures: r.figures!,
        strength: r.strength ?? 'standard',
        receivedAt: receivedAt.getTime(),
        location: latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null,
      }));
      const outcome = computeUnit(photos);

      // WIT-06: typed figures (WhatsApp, SMS) only support a photographed version; they never create one
      const typed = await tx
        .select({ reporterId: submissions.reporterId, figures: submissions.extracted })
        .from(submissions)
        .innerJoin(reporters, eq(reporters.id, submissions.reporterId))
        .where(
          and(
            eq(submissions.electionId, electionId),
            eq(submissions.pollingUnitId, pollingUnitId),
            eq(submissions.status, 'verified'),
            eq(submissions.kind, 'typed'),
            isNotNull(submissions.extracted),
            isNull(reporters.blockedAt),
          ),
        );
      const typedSupport = new Map<string, Set<string>>();
      for (const t of typed) {
        const h = figuresHash(t.figures!);
        typedSupport.set(h, (typedSupport.get(h) ?? new Set()).add(t.reporterId));
      }

      // Versions: one row per distinct set of figures
      const versionIds = new Map<string, string>();
      for (const v of outcome.versions) {
        const [saved] = await tx
          .insert(resultVersions)
          .values({
            electionId,
            pollingUnitId,
            figuresHash: v.figuresHash,
            figures: v.figures,
            witnessCount: v.witnesses,
            stampedWitnessCount: v.stampedWitnesses,
            strongWitnessCount: v.strongWitnesses,
            typedSupportCount: typedSupport.get(v.figuresHash)?.size ?? 0,
            confidence: v.confidence,
          })
          .onConflictDoUpdate({
            target: [resultVersions.electionId, resultVersions.pollingUnitId, resultVersions.figuresHash],
            set: {
              figures: v.figures,
              witnessCount: v.witnesses,
              stampedWitnessCount: v.stampedWitnesses,
              strongWitnessCount: v.strongWitnesses,
              typedSupportCount: typedSupport.get(v.figuresHash)?.size ?? 0,
              confidence: v.confidence,
              updatedAt: new Date(),
            },
          })
          .returning({ id: resultVersions.id });
        versionIds.set(v.figuresHash, saved.id);
        await tx.update(submissions).set({ versionId: saved.id }).where(inArray(submissions.id, v.submissionIds));
      }

      const [current] = await tx
        .select()
        .from(unitResults)
        .where(and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, pollingUnitId)))
        .limit(1);

      const countedVersionId = outcome.counted ? versionIds.get(outcome.counted.figuresHash)! : null;
      const base = { versionCount: outcome.versions.length, updatedAt: new Date() };

      if (current?.status === 'resolved') {
        // A reviewer's decision stands; new evidence is flagged for them to look at again
        const flags = [...new Set([...current.flags, ...outcome.flags, 'new_evidence_after_resolution'])];
        await tx.execute(sql`select pg_notify(${RESULTS_CHANNEL}, ${electionId})`);
        await tx
          .update(unitResults)
          .set({ ...base, flags, reviewSince: current.reviewSince ?? new Date(), resolvedAt: null })
          .where(and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, pollingUnitId)));
        await this.chain.syncUnitResult(electionId, pollingUnitId, tx);
        return;
      }

      // Live dashboards are told after commit (NOTIFY is delivered when the transaction commits)
      await tx.execute(sql`select pg_notify(${RESULTS_CHANNEL}, ${electionId})`);

      const values = {
        ...base,
        status: outcome.status,
        countedVersionId,
        witnessCount: outcome.counted?.witnesses ?? 0,
        confidence: outcome.counted?.confidence ?? null,
        flags: outcome.flags,
        // ADM-01: since when the unit has needed a reviewer (kept while it still does)
        reviewSince:
          outcome.status === 'provisional' || outcome.status === 'disputed' || outcome.flags.length ? (current?.reviewSince ?? new Date()) : null,
      };
      await tx
        .insert(unitResults)
        .values({ electionId, pollingUnitId, ...values })
        .onConflictDoUpdate({ target: [unitResults.electionId, unitResults.pollingUnitId], set: values });

      // WIT-07: every change of counted version is logged
      if ((current?.countedVersionId ?? null) !== countedVersionId || (current?.status ?? 'not_confirmed') !== outcome.status) {
        await this.audit.record({
          adminUserId: null,
          action: 'unit.result_changed',
          targetType: 'unit_result',
          targetId: `${electionId}:${pollingUnitId}`,
          details: {
            from: { status: current?.status ?? 'not_confirmed', versionId: current?.countedVersionId ?? null },
            to: { status: outcome.status, versionId: countedVersionId },
            witnesses: outcome.counted?.witnesses ?? 0,
          },
        }, tx);
      }
      await this.chain.syncUnitResult(electionId, pollingUnitId, tx);
    });
  }

  /** A reviewer decides which version counts for a provisional or disputed unit (WIT-08). */
  async resolve(input: { electionId: string; unitCode: string; versionId: string; reason: string }, adminId: string) {
    const code = parseUnitCode(input.unitCode);
    if (!code) throw new BadRequestException('Invalid polling unit code');
    const [unit] = await this.db.select({ id: pollingUnits.id }).from(pollingUnits).where(eq(pollingUnits.code, code.unit)).limit(1);
    if (!unit) throw new NotFoundException('Polling unit not found');

    const [version] = await this.db
      .select()
      .from(resultVersions)
      .where(
        and(
          eq(resultVersions.id, input.versionId),
          eq(resultVersions.electionId, input.electionId),
          eq(resultVersions.pollingUnitId, unit.id),
        ),
      )
      .limit(1);
    if (!version) throw new NotFoundException('That version does not belong to this polling unit');

    const [current] = await this.db
      .select()
      .from(unitResults)
      .where(and(eq(unitResults.electionId, input.electionId), eq(unitResults.pollingUnitId, unit.id)))
      .limit(1);
    if (!current) throw new NotFoundException('No result for this polling unit yet');

    await this.db
      .update(unitResults)
      .set({
        status: 'resolved',
        countedVersionId: version.id,
        witnessCount: version.witnessCount,
        confidence: version.confidence,
        resolvedBy: adminId,
        resolutionReason: input.reason,
        resolvedAt: new Date(),
        assignedTo: null,
        assignedAt: null,
        flags: [],
        updatedAt: new Date(),
      })
      .where(and(eq(unitResults.electionId, input.electionId), eq(unitResults.pollingUnitId, unit.id)));
    await this.chain.syncUnitResult(input.electionId, unit.id);
    await this.db.execute(sql`select pg_notify(${RESULTS_CHANNEL}, ${input.electionId})`);
    await this.audit.record({
      adminUserId: adminId,
      action: 'unit.resolved',
      targetType: 'unit_result',
      targetId: `${input.electionId}:${unit.id}`,
      details: { from: { status: current.status, versionId: current.countedVersionId }, versionId: version.id, reason: input.reason },
    });
    this.logger.log(`unit ${code.unit} resolved by review`);
  }
}
