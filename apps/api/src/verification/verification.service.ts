import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { ChainService } from '../chain/chain.service.js';
import type { Database } from '../database/database.module.js';
import {
  electionParties,
  elections,
  lgas,
  parties,
  pollingUnits,
  rejectionLog,
  states,
  submissions,
  wards,
} from '../database/schema.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { WitnessService } from '../witnesses/witness.service.js';
import { decide, type Decision } from './decide.js';
import { modelThatRead, TemporaryAiError, VisionModel } from './vision-model.js';

export const MAX_ATTEMPTS = 6;
/** Minutes to wait after each failed attempt */
const BACKOFF_MINUTES = [1, 2, 5, 10, 30];
/** How long a claimed submission is reserved for one worker */
const LEASE_MINUTES = 5;

@Injectable()
export class VerificationService {
  private readonly logger = new Logger('Verification');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly model: VisionModel,
    private readonly storage: EvidenceStorage,
    private readonly witnesses: WitnessService,
    private readonly chain: ChainService,
  ) {}

  /**
   * Reserves up to `limit` pending photos for processing. Uses SKIP LOCKED, so several
   * API instances can run workers without processing the same photo twice.
   */
  async claim(limit: number): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(sql`
      update ${submissions}
      set processing_attempts = processing_attempts + 1,
          next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES})
      where id in (
        select id from ${submissions}
        where status = 'pending' and kind = 'photo' and image_key is not null
          and (next_attempt_at is null or next_attempt_at <= now())
          and processing_attempts < ${MAX_ATTEMPTS}
        order by received_at
        limit ${limit}
        for update skip locked
      )
      returning id`);
    return rows.rows.map((r) => r.id);
  }

  /** Reads one photo with the AI, applies the rules and records the outcome. */
  async process(submissionId: string): Promise<Decision | null> {
    const [sub] = await this.db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
    if (!sub || sub.status !== 'pending' || !sub.imageKey) return null;

    const [election] = await this.db.select().from(elections).where(eq(elections.id, sub.electionId)).limit(1);
    const ballot = (
      await this.db
        .select({ acronym: parties.acronym })
        .from(electionParties)
        .innerJoin(parties, eq(parties.id, electionParties.partyId))
        .where(eq(electionParties.electionId, sub.electionId))
        .orderBy(asc(electionParties.ballotOrder))
    ).map((p) => p.acronym);

    let reading;
    try {
      const image = await this.storage.get(sub.imageKey);
      reading = await this.model.read(
        image,
        sub.imageType ?? 'image/jpeg',
        `Election: ${election.title}. Parties on this ballot: ${ballot.join(', ')}.`,
      );
    } catch (err) {
      const delay = BACKOFF_MINUTES[Math.min(sub.processingAttempts, BACKOFF_MINUTES.length) - 1] ?? 30;
      this.logger.warn(`submission ${sub.id}: attempt ${sub.processingAttempts} failed (${(err as Error).message}); retry in ${delay} min`);
      await this.db
        .update(submissions)
        .set({ nextAttemptAt: new Date(Date.now() + delay * 60_000) })
        .where(eq(submissions.id, sub.id));
      if (!(err instanceof TemporaryAiError)) throw err;
      return null;
    }

    // The polling unit the voter entered (checked against the register at upload)
    const [unit] = sub.pollingUnitId
      ? await this.db
          .select({ id: pollingUnits.id, code: pollingUnits.code, wardCode: wards.code, lgaCode: lgas.code, stateCode: states.code })
          .from(pollingUnits)
          .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
          .innerJoin(lgas, eq(lgas.id, wards.lgaId))
          .innerJoin(states, eq(states.id, lgas.stateId))
          .where(eq(pollingUnits.id, sub.pollingUnitId))
          .limit(1)
      : [];
    if (!unit) {
      this.logger.error(`submission ${sub.id}: no polling unit recorded`);
      return null;
    }

    const decision = decide(reading, {
      election: {
        type: election.type,
        scopeLevel: election.scopeLevel,
        scopeCode: election.scopeCode,
        pollsCloseAt: election.pollsCloseAt,
      },
      ballot,
      receivedAt: sub.receivedAt,
      unit,
    });

    const audit = {
      reading,
      decision: {
        outcome: decision.outcome,
        code: 'code' in decision ? decision.code : null,
        flags: 'flags' in decision ? decision.flags : null,
      },
    };
    const common = { verification: audit, processedAt: new Date(), model: modelThatRead(reading, this.model.name), nextAttemptAt: null };

    switch (decision.outcome) {
      case 'verified':
        await this.db
          .update(submissions)
          .set({ ...common, status: 'verified', extracted: decision.figures, evidenceStrength: decision.strength, reviewReason: null })
          .where(eq(submissions.id, sub.id));
        await this.chain.syncSubmission(sub.id);
        await this.witnesses.recalculate(sub.electionId, unit.id);
        break;
      case 'needs_confirmation':
        await this.db
          .update(submissions)
          .set({
            ...common,
            status: 'needs_confirmation',
            extracted: decision.figures,
            evidenceStrength: decision.strength,
            reviewReason: decision.reason,
          })
          .where(eq(submissions.id, sub.id));
        break;
      case 'retake':
      case 'rejected':
        // VER-05: images that fail verification are not kept; only a log entry remains
        await this.discardImage(sub.imageKey, sub.id);
        await this.db
          .update(submissions)
          .set({
            ...common,
            status: 'rejected',
            imageKey: null,
            retakeRequested: decision.outcome === 'retake',
            reviewReason: decision.reason,
          })
          .where(eq(submissions.id, sub.id));
        await this.db.insert(rejectionLog).values({ reporterId: sub.reporterId, electionId: sub.electionId, reason: decision.code });
        break;
    }
    if (decision.outcome !== 'verified') await this.chain.syncSubmission(sub.id);
    this.logger.log(`submission ${sub.id}: ${decision.outcome}${'code' in decision ? ` (${decision.code})` : ''}`);
    return decision;
  }

  /** The voter confirms (or disputes) figures that did not add up (VER-09). */
  async confirmFigures(submissionId: string, reporterId: string, confirmed: boolean) {
    const [sub] = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, submissionId), eq(submissions.reporterId, reporterId)))
      .limit(1);
    if (!sub || sub.status !== 'needs_confirmation') return null;

    if (confirmed) {
      // The poster itself may contain an error; keep it as evidence, flagged for review
      await this.db
        .update(submissions)
        .set({ status: 'verified', voterConfirmed: true, reviewReason: 'Voter confirmed the figures match the poster, although they do not add up.' })
        .where(eq(submissions.id, sub.id));
      await this.chain.syncSubmission(sub.id);
      if (sub.pollingUnitId) await this.witnesses.recalculate(sub.electionId, sub.pollingUnitId);
    } else {
      if (sub.imageKey) await this.discardImage(sub.imageKey, sub.id);
      await this.db
        .update(submissions)
        .set({
          status: 'rejected',
          imageKey: null,
          retakeRequested: true,
          reviewReason: 'You said the figures were read wrongly. Please take a clearer photo of the poster.',
        })
        .where(eq(submissions.id, sub.id));
      await this.db.insert(rejectionLog).values({ reporterId, electionId: sub.electionId, reason: 'voter_disputed_reading' });
      await this.chain.syncSubmission(sub.id);
    }
    return this.statusFor(submissionId, reporterId);
  }

  /** What the voter sees about their own photo. Never includes other voters' data. */
  async statusFor(submissionId: string, reporterId: string) {
    const [row] = await this.db
      .select({
        id: submissions.id,
        status: submissions.status,
        reason: submissions.reviewReason,
        retake: submissions.retakeRequested,
        figures: submissions.extracted,
        evidenceStrength: submissions.evidenceStrength,
        unitCode: pollingUnits.code,
        unitName: pollingUnits.name,
        attempts: submissions.processingAttempts,
      })
      .from(submissions)
      .leftJoin(pollingUnits, eq(pollingUnits.id, submissions.pollingUnitId))
      .where(and(eq(submissions.id, submissionId), eq(submissions.reporterId, reporterId)))
      .limit(1);
    return row ?? null;
  }

  /** Deletes a rejected image, unless another submission holds identical bytes. */
  private async discardImage(key: string, submissionId: string) {
    const others = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.imageKey, key), ne(submissions.id, submissionId)))
      .limit(1);
    if (others.length === 0) await this.storage.remove(key);
  }
}
