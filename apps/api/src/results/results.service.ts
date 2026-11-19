import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { parseUnitCode } from '@trustelect/shared';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import {
  electionParties,
  elections,
  lgas,
  parties,
  pollingUnits,
  resultVersions,
  states,
  submissions,
  unitResults,
  wards,
} from '../database/schema.js';

const unitColumns = {
  id: pollingUnits.id,
  code: pollingUnits.code,
  name: pollingUnits.name,
  wardCode: wards.code,
  wardName: wards.name,
  lgaCode: lgas.code,
  lgaName: lgas.name,
  stateCode: states.code,
  stateName: states.name,
};

@Injectable()
export class ResultsService {
  /** Named prepared statements for the hottest public lookups: planned once per connection, not per request */
  private readonly unitQuery;
  private readonly unitResultQuery;

  constructor(@InjectDrizzle() private readonly db: Database) {
    this.unitQuery = db
      .select(unitColumns)
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .innerJoin(states, eq(states.id, lgas.stateId))
      .where(eq(pollingUnits.code, sql.placeholder('code')))
      .limit(1)
      .prepare('public_unit_by_code');
    this.unitResultQuery = db
      .select({
        status: unitResults.status,
        witnessCount: unitResults.witnessCount,
        confidence: unitResults.confidence,
        versionCount: unitResults.versionCount,
        updatedAt: unitResults.updatedAt,
        figures: resultVersions.figures,
        stampedWitnesses: resultVersions.stampedWitnessCount,
        strongWitnesses: resultVersions.strongWitnessCount,
      })
      .from(unitResults)
      .leftJoin(resultVersions, eq(resultVersions.id, unitResults.countedVersionId))
      .where(and(eq(unitResults.electionId, sql.placeholder('electionId')), eq(unitResults.pollingUnitId, sql.placeholder('unitId'))))
      .limit(1)
      .prepare('public_unit_result');
  }

  /**
   * Short in-memory caches for what every public lookup needs and that rarely changes
   * (Sprint 16 load test: unit lookups made 4-5 round trips each). Shared while loading.
   */
  private readonly memo = new Map<string, { at: number; value: Promise<unknown> }>();
  private cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.value as Promise<T>;
    const value = load();
    this.memo.set(key, { at: Date.now(), value });
    value.catch(() => this.memo.delete(key));
    return value;
  }

  private async unitByCode(raw: string) {
    const code = parseUnitCode(raw);
    if (!code) throw new NotFoundException('Not a valid polling unit code');
    const [unit] = await this.unitQuery.execute({ code: code.unit });
    if (!unit) throw new NotFoundException('Polling unit not found in the register');
    return unit;
  }

  private ballot(electionId: string) {
    return this.cached(`ballot|${electionId}`, 60_000, () => this.loadBallot(electionId));
  }

  private async loadBallot(electionId: string) {
    return this.db
      .select({ acronym: parties.acronym, name: parties.name })
      .from(electionParties)
      .innerJoin(parties, eq(parties.id, electionParties.partyId))
      .where(eq(electionParties.electionId, electionId))
      .orderBy(asc(electionParties.ballotOrder));
  }

  /**
   * Public: the citizen-collated result of a polling unit in every published election
   * covering it. Figures only for counted, provisional or resolved units; never who sent photos.
   */
  async publicUnitResults(rawCode: string) {
    const unit = await this.unitByCode(rawCode);
    // Published elections, newest first (cached briefly); those whose area covers this unit
    const published = await this.cached('published-elections', 10_000, () =>
      this.db.select().from(elections).where(ne(elections.status, 'draft')).orderBy(desc(elections.electionDate)),
    );
    const scopeOf = { national: null, state: unit.stateCode, lga: unit.lgaCode, ward: unit.wardCode, polling_unit: unit.code } as const;
    const covering = published.filter((e) => e.scopeLevel === 'national' || e.scopeCode === scopeOf[e.scopeLevel]);

    const results = await Promise.all(
      covering.map(async (election) => {
        const [row] = await this.unitResultQuery.execute({ electionId: election.id, unitId: unit.id });
        const showFigures = row && row.status !== 'disputed' && row.figures;
        return {
          election: { id: election.id, title: election.title, type: election.type, electionDate: election.electionDate, status: election.status },
          status: row?.status ?? 'not_confirmed',
          confidence: row?.confidence ?? null,
          witnessCount: row?.witnessCount ?? 0,
          stampedWitnesses: row?.stampedWitnesses ?? 0,
          strongWitnesses: row?.strongWitnesses ?? 0,
          versionCount: row?.versionCount ?? 0,
          updatedAt: row?.updatedAt ?? null,
          parties: await this.ballot(election.id),
          figures: showFigures ? row.figures : null,
        };
      }),
    );
    const { id: _id, ...publicUnit } = unit;
    return { unit: publicUnit, results };
  }

  /** Admin: units that need a reviewer (provisional, disputed, or flagged). */
  async reviewQueue() {
    return this.db
      .select({
        electionId: elections.id,
        electionTitle: elections.title,
        unitCode: pollingUnits.code,
        unitName: pollingUnits.name,
        status: unitResults.status,
        flags: unitResults.flags,
        versionCount: unitResults.versionCount,
        witnessCount: unitResults.witnessCount,
        updatedAt: unitResults.updatedAt,
      })
      .from(unitResults)
      .innerJoin(elections, eq(elections.id, unitResults.electionId))
      .innerJoin(pollingUnits, eq(pollingUnits.id, unitResults.pollingUnitId))
      .where(
        or(
          inArray(unitResults.status, ['provisional', 'disputed']),
          sql`jsonb_array_length(${unitResults.flags}) > 0`,
        ),
      )
      .orderBy(
        sql`case ${unitResults.status} when 'disputed' then 0 when 'provisional' then 1 else 2 end`,
        asc(unitResults.updatedAt),
      )
      .limit(200);
  }

  /** Admin: every version of a unit's result with the photos behind it. */
  async unitDetail(electionId: string, rawCode: string) {
    const unit = await this.unitByCode(rawCode);
    const [election] = await this.db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
    if (!election) throw new NotFoundException('Election not found');
    const [result] = await this.db
      .select()
      .from(unitResults)
      .where(and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, unit.id)))
      .limit(1);
    const versions = await this.db
      .select()
      .from(resultVersions)
      .where(and(eq(resultVersions.electionId, electionId), eq(resultVersions.pollingUnitId, unit.id)))
      .orderBy(desc(resultVersions.witnessCount));
    const photos = await this.db
      .select({
        id: submissions.id,
        versionId: submissions.versionId,
        status: submissions.status,
        evidenceStrength: submissions.evidenceStrength,
        receivedAt: submissions.receivedAt,
        capturedAt: submissions.capturedAt,
        hasImage: sql<boolean>`${submissions.imageKey} is not null`,
        reason: submissions.reviewReason,
        voterConfirmed: submissions.voterConfirmed,
      })
      .from(submissions)
      .where(and(eq(submissions.electionId, electionId), eq(submissions.pollingUnitId, unit.id)))
      .orderBy(asc(submissions.receivedAt));
    const { id: _id, ...publicUnit } = unit;
    return {
      unit: publicUnit,
      election: { id: election.id, title: election.title },
      parties: await this.ballot(electionId),
      result: result
        ? {
            status: result.status,
            countedVersionId: result.countedVersionId,
            witnessCount: result.witnessCount,
            confidence: result.confidence,
            flags: result.flags,
            resolutionReason: result.resolutionReason,
            updatedAt: result.updatedAt,
          }
        : null,
      versions: versions.map((v) => ({
        id: v.id,
        figures: v.figures,
        witnessCount: v.witnessCount,
        stampedWitnessCount: v.stampedWitnessCount,
        strongWitnessCount: v.strongWitnessCount,
        confidence: v.confidence,
      })),
      photos,
    };
  }

  /** Admin: where a stored photo is, for viewing. */
  async imageKey(submissionId: string) {
    const [row] = await this.db
      .select({ key: submissions.imageKey, type: submissions.imageType })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!row?.key) throw new NotFoundException('No stored photo');
    return { key: row.key, type: row.type };
  }
}
