import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { declarations, pollingUnits, resultVersions, submissions, unitResults } from '../database/schema.js';

/** A database handle or an open transaction */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The canonical form of each chained record (EVD-02). Only what the evidence needs:
 * no phone numbers, device or network hashes, locations or other personal data, so a
 * record can be published in an evidence pack exactly as it was chained.
 */

export const unitRef = (electionId: string, unitCode: string) => `${electionId}:${unitCode}`;

export async function submissionRecord(db: Executor, id: string) {
  const [s] = await db
    .select({
      id: submissions.id,
      electionId: submissions.electionId,
      unitCode: pollingUnits.code,
      kind: submissions.kind,
      channel: submissions.channel,
      status: submissions.status,
      capturedAt: submissions.capturedAt,
      receivedAt: submissions.receivedAt,
      imageSha256: submissions.imageSha256,
      imageType: submissions.imageType,
      imageBytes: submissions.imageBytes,
      figures: submissions.extracted,
      evidenceStrength: submissions.evidenceStrength,
      voterConfirmed: submissions.voterConfirmed,
      retakeRequested: submissions.retakeRequested,
    })
    .from(submissions)
    .leftJoin(pollingUnits, eq(pollingUnits.id, submissions.pollingUnitId))
    .where(eq(submissions.id, id))
    .limit(1);
  return s ?? null;
}

export async function unitResultRecord(db: Executor, electionId: string, pollingUnitId: number) {
  const [r] = await db
    .select({
      status: unitResults.status,
      countedVersionId: unitResults.countedVersionId,
      witnessCount: unitResults.witnessCount,
      confidence: unitResults.confidence,
      versionCount: unitResults.versionCount,
      flags: unitResults.flags,
      resolvedBy: unitResults.resolvedBy,
      resolutionReason: unitResults.resolutionReason,
      unitCode: pollingUnits.code,
    })
    .from(unitResults)
    .innerJoin(pollingUnits, eq(pollingUnits.id, unitResults.pollingUnitId))
    .where(and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, pollingUnitId)))
    .limit(1);
  if (!r) return null;
  const versions = await db
    .select()
    .from(resultVersions)
    .where(and(eq(resultVersions.electionId, electionId), eq(resultVersions.pollingUnitId, pollingUnitId)))
    .orderBy(asc(resultVersions.figuresHash));
  const { countedVersionId, unitCode, ...rest } = r;
  return {
    ref: unitRef(electionId, unitCode),
    record: {
      electionId,
      unitCode,
      ...rest,
      countedFiguresHash: versions.find((v) => v.id === countedVersionId)?.figuresHash ?? null,
      // Witness counts only: who the witnesses are is never published (EVD-04)
      versions: versions.map((v) => ({
        figuresHash: v.figuresHash,
        figures: v.figures,
        witnessCount: v.witnessCount,
        stampedWitnessCount: v.stampedWitnessCount,
        strongWitnessCount: v.strongWitnessCount,
        typedSupportCount: v.typedSupportCount,
        confidence: v.confidence,
      })),
    },
  };
}

export async function declarationRecord(db: Executor, id: string) {
  const [d] = await db
    .select({
      id: declarations.id,
      electionId: declarations.electionId,
      level: declarations.level,
      areaCode: declarations.areaCode,
      figures: declarations.figures,
      unitFigures: declarations.unitFigures,
      declaredAt: declarations.declaredAt,
      sourceKind: declarations.sourceKind,
      sourceUrl: declarations.sourceUrl,
      sourceSha256: declarations.sourceSha256,
      status: declarations.status,
      enteredBy: declarations.enteredBy,
      approvedBy: declarations.approvedBy,
      approvedAt: declarations.approvedAt,
      rejectionReason: declarations.rejectionReason,
    })
    .from(declarations)
    .where(eq(declarations.id, id))
    .limit(1);
  return d ?? null;
}
