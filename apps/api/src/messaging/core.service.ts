import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { UNOFFICIAL_LABEL } from '@trustelect/shared';
import { and, asc, count, eq, gt, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CaptureService } from '../capture/capture.service.js';
import { normaliseNigerianMobile } from '../capture/phone.js';
import { ChainService } from '../chain/chain.service.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { electionParties, elections, lgas, parties, pollingUnits, resultVersions, states, submissions, wards } from '../database/schema.js';
import { ResultsService } from '../results/results.service.js';
import { TallyService } from '../tally/tally.service.js';
import { figuresHash } from '../witnesses/engine.js';
import { WitnessService } from '../witnesses/witness.service.js';

export type Channel = 'whatsapp' | 'sms' | 'ussd';
export type Format = 'whatsapp' | 'plain';
export type Area = { level: 'polling_unit' | 'ward' | 'lga' | 'state'; code: string };
export type TypedFigures = { unitCode: string; votes: Record<string, number> };
/** A reply, and whether it may be translated (figures in it are protected by the number check) */
export type Reply = { text: string; translate?: boolean; rememberUnit?: string };

const TYPED_PER_HOUR = 10;

const UNIT_STATUS: Record<string, string> = {
  not_confirmed: 'No confirmed result yet',
  counted: 'Counted',
  provisional: 'Provisional: witnesses disagree, under review',
  disputed: 'Disputed: not counted until reviewed',
  resolved: 'Resolved by review',
};
const COMPARISON: Record<string, string> = {
  match: 'Matches the declared result',
  match_so_far: 'Matches the declared result so far',
  does_not_match: 'Does not match the declared result',
  possible_mismatch_low_confidence: 'Possible mismatch (low confidence)',
  conflicting_declarations: 'Conflicting declarations, under review',
  awaiting_data: 'No approved declaration to compare yet',
};


const bold = (text: string, format: Format) => (format === 'whatsapp' ? `*${text}*` : text);

/**
 * What every channel (WhatsApp, SMS, USSD) can do, as reply text: result lookups (CNT-08, INF-03),
 * typed figures (CAP-06, WIT-06) and camera links (CAP-02, INF-06).
 */
@Injectable()
export class MessagingCore {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly capture: CaptureService,
    private readonly results: ResultsService,
    private readonly tally: TallyService,
    private readonly witnesses: WitnessService,
    private readonly chain: ChainService,
  ) {}

  private get web() {
    return this.config.get('WEB_ORIGIN', { infer: true });
  }

  /* --------------------------------- lookups -------------------------------- */

  async lookup(area: Area, format: Format): Promise<Reply> {
    if (area.level === 'polling_unit') return this.unitLookup(area.code, format);

    const covering = (await this.db.select().from(elections).where(ne(elections.status, 'draft')).orderBy(asc(elections.electionDate)))
      .filter((e) => e.scopeLevel === 'national' || (e.scopeCode !== null && area.code.startsWith(e.scopeCode)));
    const blocks: string[] = [];
    let name = area.code;
    for (const e of covering) {
      try {
        const t = await this.tally.area(e.id, area.level, area.code);
        name = t.area.name;
        const votes = t.parties.map((p: { acronym: string }) => `${p.acronym} ${(t.totals.partyVotes[p.acronym] ?? 0).toLocaleString('en-NG')}`).join(' · ');
        blocks.push(
          [
            bold(e.title, format),
            `Counted from ${t.totals.countedUnits.toLocaleString('en-NG')} of ${t.totals.totalUnits.toLocaleString('en-NG')} polling units`,
            t.totals.countedUnits ? votes : 'No counted polling units yet',
            t.totals.comparison ? COMPARISON[t.totals.comparison.status] : null,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (err) {
        if (!(err instanceof NotFoundException) && !(err instanceof HttpException)) throw err;
      }
    }
    if (!blocks.length) return { text: `No published election covers ${area.code} yet, or that code is not in the register.`, translate: true };
    return { text: `${name} (${area.code})\n\n${blocks.join('\n\n')}\n\n${UNOFFICIAL_LABEL}. Not a projection. More: ${this.web}/results/elections` };
  }

  private async unitLookup(code: string, format: Format): Promise<Reply> {
    let found;
    try {
      found = await this.results.publicUnitResults(code);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof HttpException) {
        return { text: `${code} is not in the polling unit register. Check the code on your voter's card or the result poster.`, translate: true };
      }
      throw err;
    }
    const head = `${found.unit.name} (${found.unit.code})\n${found.unit.wardName} ward, ${found.unit.lgaName}, ${found.unit.stateName}`;
    if (!found.results.length) return { text: `${head}\n\nNo published election covers this polling unit yet.`, rememberUnit: found.unit.code };
    const blocks = found.results.map((r) => {
      const lines = [bold(r.election.title, format), UNIT_STATUS[r.status] ?? r.status];
      if (r.figures) {
        lines.push(r.parties.map((p) => `${p.acronym} ${r.figures!.partyVotes[p.acronym] ?? 0}`).join(' · '));
        lines.push(`Total valid ${r.figures.totalValid}`);
        lines.push(`${r.confidence ? `${r.confidence[0].toUpperCase()}${r.confidence.slice(1)} confidence: ` : ''}${r.witnessCount} independent ${r.witnessCount === 1 ? 'witness' : 'witnesses'}`);
      }
      return lines.join('\n');
    });
    return { text: `${head}\n\n${blocks.join('\n\n')}\n\n${UNOFFICIAL_LABEL}.`, rememberUnit: found.unit.code };
  }

  /* ------------------------------ capture link ------------------------------ */

  /** A one-time camera link for this phone (E.164), or why there is none */
  async captureLink(phoneE164: string, channel: Channel): Promise<Reply> {
    const phone = normaliseNigerianMobile(phoneE164);
    if (!phone) return { text: `Results can only be sent from Nigerian mobile numbers. Open ${this.web}/capture on a phone with a Nigerian number.`, translate: true };
    try {
      const link = await this.capture.issueLink(phone, channel === 'ussd' ? 'sms' : channel);
      return {
        text: `Open this link to photograph the EC60E result poster with your camera. It works once, for 30 minutes, and is linked to this number:\n${link}`,
        translate: true,
      };
    } catch (err) {
      if (err instanceof HttpException) return { text: 'This number cannot send results to TrustElect.' };
      throw err;
    }
  }

  /* ------------------------------ typed figures ----------------------------- */

  async unitWithArea(code: string) {
    const [unit] = await this.db
      .select({ id: pollingUnits.id, code: pollingUnits.code, wardCode: wards.code, lgaCode: lgas.code, stateCode: states.code })
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .innerJoin(states, eq(states.id, lgas.stateId))
      .where(eq(pollingUnits.code, code))
      .limit(1);
    return unit ?? null;
  }

  async openElectionsFor(unitCode: string) {
    const unit = await this.unitWithArea(unitCode);
    if (!unit) return null;
    return this.db
      .select({ id: elections.id, title: elections.title })
      .from(elections)
      .where(
        and(
          eq(elections.status, 'active'),
          or(
            eq(elections.scopeLevel, 'national'),
            and(eq(elections.scopeLevel, 'state'), eq(elections.scopeCode, unit.stateCode)),
            and(eq(elections.scopeLevel, 'lga'), eq(elections.scopeCode, unit.lgaCode)),
            and(eq(elections.scopeLevel, 'ward'), eq(elections.scopeCode, unit.wardCode)),
            and(eq(elections.scopeLevel, 'polling_unit'), eq(elections.scopeCode, unit.code)),
          ),
        ),
      )
      .orderBy(asc(elections.title));
  }

  /**
   * Checks typed figures; when exactly one election is open it records them, otherwise asks
   * which election (the channel shows the choice).
   */
  async typedFigures(phoneE164: string, channel: Channel, figures: TypedFigures): Promise<Reply | { choose: { id: string; title: string }[]; unitCode: string }> {
    const open = await this.openElectionsFor(figures.unitCode);
    if (open === null) return { text: `${figures.unitCode} is not in the polling unit register. Check the code on the result poster.`, translate: true };
    if (!open.length) return { text: `No election is open for results at ${figures.unitCode} right now.`, translate: true };
    if (open.length > 1) return { choose: open, unitCode: figures.unitCode };
    return this.recordFigures(phoneE164, channel, open[0].id, figures);
  }

  /** The ballot of an election, in ballot order */
  async ballot(electionId: string) {
    return (
      await this.db
        .select({ acronym: parties.acronym })
        .from(electionParties)
        .innerJoin(parties, eq(parties.id, electionParties.partyId))
        .where(eq(electionParties.electionId, electionId))
        .orderBy(asc(electionParties.ballotOrder))
    ).map((p) => p.acronym.toUpperCase());
  }

  /** CAP-06, WIT-06: typed figures are a supporting witness for a photographed version, never a version of their own */
  async recordFigures(phoneE164: string, channel: Channel, electionId: string, figures: TypedFigures): Promise<Reply> {
    const phone = normaliseNigerianMobile(phoneE164);
    if (!phone) return { text: 'Results can only be sent from Nigerian mobile numbers.', translate: true };
    const unit = await this.unitWithArea(figures.unitCode);
    const [election] = unit ? ((await this.openElectionsFor(unit.code)) ?? []).filter((e) => e.id === electionId) : [];
    if (!unit || !election) return { text: 'That election is not open for results at this polling unit.', translate: true };

    const ballot = (
      await this.db
        .select({ acronym: parties.acronym })
        .from(electionParties)
        .innerJoin(parties, eq(parties.id, electionParties.partyId))
        .where(eq(electionParties.electionId, electionId))
        .orderBy(asc(electionParties.ballotOrder))
    ).map((p) => p.acronym.toUpperCase());
    const given = Object.keys(figures.votes);
    const unknown = given.filter((p) => !ballot.includes(p));
    const missing = ballot.filter((p) => !given.includes(p));
    if (unknown.length || missing.length) {
      return {
        text: [
          unknown.length ? `Not on this ballot: ${unknown.join(', ')}.` : null,
          missing.length ? `Missing: ${missing.join(', ')}.` : null,
          `Send every party on the poster, in this format:\nPU ${unit.code} ${ballot.map((p) => `${p} 0`).join(' ')}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    const reporterId = await this.capture.reporterFor(phone);
    const [{ recent }] = await this.db
      .select({ recent: count() })
      .from(submissions)
      .where(and(eq(submissions.reporterId, reporterId), eq(submissions.kind, 'typed'), gt(submissions.receivedAt, new Date(Date.now() - 3_600_000))));
    if (recent >= TYPED_PER_HOUR) return { text: 'Too many results from this number in the last hour. Try again later.', translate: true };

    const extracted = { partyVotes: figures.votes, totalValid: Object.values(figures.votes).reduce((a, b) => a + b, 0), rejected: null, totalCast: null };
    const [row] = await this.db
      .insert(submissions)
      .values({ electionId, pollingUnitId: unit.id, reporterId, kind: 'typed', channel, status: 'verified', extracted, clientId: randomUUID(), processedAt: new Date() })
      .returning({ id: submissions.id });
    await this.chain.syncSubmission(row.id);
    await this.witnesses.recalculate(electionId, unit.id);

    const [version] = await this.db
      .select({ witnessCount: resultVersions.witnessCount })
      .from(resultVersions)
      .where(and(eq(resultVersions.electionId, electionId), eq(resultVersions.pollingUnitId, unit.id), eq(resultVersions.figuresHash, figuresHash(extracted))))
      .limit(1);
    const summary = ballot.map((p) => `${p} ${figures.votes[p]}`).join(' · ');
    const next = channel === 'whatsapp' ? 'send PHOTO for a camera link' : 'text PHOTO for a camera link';
    if (version) {
      return {
        text: `Recorded for ${unit.code} (${election.title}): ${summary}.\nThese figures match a result photographed by ${version.witnessCount} ${version.witnessCount === 1 ? 'witness' : 'witnesses'}; yours is counted as supporting evidence. Thank you.`,
        translate: true,
        rememberUnit: unit.code,
      };
    }
    return {
      text: `Recorded for ${unit.code} (${election.title}): ${summary}.\nNo photo of these figures has been verified yet. Typed figures support photos but never count on their own. If you are at the polling unit, ${next}.`,
      translate: true,
      rememberUnit: unit.code,
    };
  }
}
