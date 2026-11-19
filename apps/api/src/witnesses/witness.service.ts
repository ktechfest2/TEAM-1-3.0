import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { parseUnitCode } from '@trustelect/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { Database } from '../database/database.module.js';
import { pollingUnits, resultVersions, submissions, unitResults } from '../database/schema.js';
import { computeUnit, type AcceptedPhoto } from './engine.js';

@Injectable()
export class WitnessService {
  private readonly logger = new Logger('Witnesses');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
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
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.electionId, electionId),
            eq(submissions.pollingUnitId, pollingUnitId),
            eq(submissions.status, 'verified'),
            eq(submissions.kind, 'photo'),
            isNotNull(submissions.extracted),
          ),
        );
      const photos: AcceptedPhoto[] = rows.map((r) => ({ ...r, figures: r.figures!, strength: r.strength ?? 'standard' }));
      const outcome = computeUnit(photos);

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
            confidence: v.confidence,
          })
          .onConflictDoUpdate({
            target: [resultVersions.electionId, resultVersions.pollingUnitId, resultVersions.figuresHash],
            set: {
              figures: v.figures,
              witnessCount: v.witnesses,
              stampedWitnessCount: v.stampedWitnesses,
              strongWitnessCount: v.strongWitnesses,
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
        await tx
          .update(unitResults)
          .set({ ...base, flags })
          .where(and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, pollingUnitId)));
        return;
      }

      const values = {
        ...base,
        status: outcome.status,
        countedVersionId,
        witnessCount: outcome.counted?.witnesses ?? 0,
        confidence: outcome.counted?.confidence ?? null,
        flags: outcome.flags,
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
        });
      }
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
        flags: [],
        updatedAt: new Date(),
      })
      .where(and(eq(unitResults.electionId, input.electionId), eq(unitResults.pollingUnitId, unit.id)));
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
