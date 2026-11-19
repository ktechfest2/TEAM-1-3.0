import { parseUnitCode } from '@trustelect/shared';
import type { ResultFigures } from '../database/schema.js';
import type { Ec60eReading } from './reading.js';

/**
 * TrustElect's verification rules (Specification VER-01 to VER-09, as amended 19 Nov:
 * the voter supplies the polling unit; a missing stamp lowers evidence strength). The vision model only
 * describes the photo; these rules decide what happens, so they are testable and consistent.
 */

export type ElectionType =
  | 'presidential'
  | 'governorship'
  | 'senate'
  | 'house_of_representatives'
  | 'state_assembly'
  | 'area_council'
  | 'local_government';

export interface DecisionContext {
  election: {
    type: ElectionType;
    scopeLevel: 'polling_unit' | 'ward' | 'lga' | 'state' | 'national';
    scopeCode: string | null;
    pollsCloseAt: Date;
  };
  /** Party acronyms on this election's ballot, in ballot order */
  ballot: string[];
  receivedAt: Date;
  /** The polling unit the voter entered, already checked against INEC's register */
  unit: { code: string; wardCode: string; lgaCode: string; stateCode: string };
}

/**
 * Evidence strength of an accepted photo:
 *   strong   = stamp visible and the code on the poster matches the voter's polling unit
 *   standard = stamp visible, no readable code on the poster
 *   low      = no visible stamp (accepted, but weighs less)
 */
export type EvidenceStrength = 'strong' | 'standard' | 'low';

export interface EvidenceFlags {
  stampVisible: boolean;
  /** True: poster code matches. Null: no readable code on the poster. */
  posterCodeMatches: boolean | null;
}

export type Decision =
  | { outcome: 'verified'; unitCode: string; figures: ResultFigures; strength: EvidenceStrength; flags: EvidenceFlags; notes: string[] }
  | {
      outcome: 'needs_confirmation';
      unitCode: string;
      figures: ResultFigures;
      strength: EvidenceStrength;
      flags: EvidenceFlags;
      code: string;
      reason: string;
    }
  | { outcome: 'retake'; code: string; reason: string }
  | { outcome: 'rejected'; code: string; reason: string };

const QUALITY_MESSAGES: Record<Exclude<Ec60eReading['image_quality'], 'good'>, string> = {
  blurred: 'The photo is blurred. Hold the phone steady and take it again.',
  cropped: 'Part of the poster is cut off. Fit the whole poster inside the frame and take it again.',
  too_dark: 'The photo is too dark. Move to better light or step closer, then take it again.',
  glare: 'Light is reflecting off the poster. Change your angle to avoid the glare and take it again.',
  too_far: 'The poster is too far away to read. Step closer and take it again.',
};

/** Keywords that identify the election type printed on a form */
const ELECTION_KEYWORDS: [ElectionType, RegExp][] = [
  ['presidential', /presiden/i],
  ['governorship', /governor/i],
  ['senate', /senat/i],
  ['house_of_representatives', /house of rep|\breps?\b|federal constituency/i],
  ['state_assembly', /house of assembly|state assembly|state constituency/i],
  ['area_council', /area council/i],
  ['local_government', /local government|\blga\b/i],
];

export function electionTypeFromText(text: string | null): ElectionType | null {
  if (!text) return null;
  return ELECTION_KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** Compares party acronyms ignoring case, spaces and punctuation (A.P.C. = APC). */
export function normaliseParty(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function inScope(unit: DecisionContext['unit'], scope: DecisionContext['election']): boolean {
  switch (scope.scopeLevel) {
    case 'national':
      return true;
    case 'state':
      return unit.stateCode === scope.scopeCode;
    case 'lga':
      return unit.lgaCode === scope.scopeCode;
    case 'ward':
      return unit.wardCode === scope.scopeCode;
    case 'polling_unit':
      return unit.code === scope.scopeCode;
  }
}

export function decide(reading: Ec60eReading, ctx: DecisionContext): Decision {
  // VER-01: must be an EC60E
  if (!reading.is_ec60e) {
    return {
      outcome: 'rejected',
      code: 'not_ec60e',
      reason: `This is not an EC60E result poster (it looks like: ${reading.document_description || 'another image'}). Only the poster pasted at the polling unit can be used.`,
    };
  }

  // VER-06: readable photo
  if (reading.image_quality !== 'good') {
    return { outcome: 'retake', code: `quality_${reading.image_quality}`, reason: QUALITY_MESSAGES[reading.image_quality] };
  }

  // VER-03: a signature is required. A missing stamp lowers the evidence strength (decision of 19 Nov).
  if (!reading.signature_present) {
    return {
      outcome: 'retake',
      code: 'no_signature',
      reason: "The Presiding Officer's signature is not visible. Take the photo again with the signature in view.",
    };
  }

  // VER-04: the poster only exists after polls close
  if (ctx.receivedAt.getTime() < ctx.election.pollsCloseAt.getTime()) {
    return {
      outcome: 'rejected',
      code: 'before_polls_close',
      reason: 'This photo arrived before polls closed for this election, so it cannot be a result poster for it.',
    };
  }

  // VER-02: the voter's polling unit must be in this election's area
  if (!inScope(ctx.unit, ctx.election)) {
    return {
      outcome: 'rejected',
      code: 'outside_election_area',
      reason: `Polling unit ${ctx.unit.code} is not part of this election's area. Check you chose the right election.`,
    };
  }

  // If the poster shows a polling unit code, it must be the voter's unit; a match strengthens the evidence
  const posterCode = reading.polling_unit_code ? parseUnitCode(reading.polling_unit_code) : null;
  if (posterCode && posterCode.unit !== ctx.unit.code) {
    return {
      outcome: 'retake',
      code: 'unit_code_mismatch',
      reason: `The poster shows polling unit ${posterCode.unit}, but you entered ${ctx.unit.code}. Check the code you entered and try again.`,
    };
  }
  const flags: EvidenceFlags = { stampVisible: reading.stamp_visible, posterCodeMatches: posterCode ? true : null };
  const strength: EvidenceStrength = !flags.stampVisible ? 'low' : flags.posterCodeMatches ? 'strong' : 'standard';

  // VER-02: election type printed on the form
  const printedType = electionTypeFromText(reading.election_type_on_form);
  if (printedType && printedType !== ctx.election.type) {
    return {
      outcome: 'rejected',
      code: 'wrong_election',
      reason: `This poster is for a ${reading.election_type_on_form} election, not the election you chose. Choose the matching election and try again.`,
    };
  }

  // VER-07: every figure readable
  if (reading.party_results.some((r) => !r.legible || r.votes === null)) {
    return {
      outcome: 'retake',
      code: 'unreadable_figures',
      reason: 'Some vote figures are not readable. Take a closer, sharper photo of the figures.',
    };
  }

  // VER-02: parties match the ballot
  const ballotByKey = new Map(ctx.ballot.map((a) => [normaliseParty(a), a]));
  const partyVotes: Record<string, number> = {};
  const unknown: string[] = [];
  for (const row of reading.party_results) {
    const acronym = ballotByKey.get(normaliseParty(row.party));
    if (!acronym) unknown.push(row.party);
    else partyVotes[acronym] = (partyVotes[acronym] ?? 0) + (row.votes ?? 0);
  }
  if (unknown.length) {
    return {
      outcome: 'rejected',
      code: 'party_not_on_ballot',
      reason: `The poster lists parties that are not on this election's ballot (${unknown.join(', ')}). Check you chose the right election.`,
    };
  }
  const missing = ctx.ballot.filter((a) => !(a in partyVotes));
  if (missing.length) {
    return {
      outcome: 'retake',
      code: 'parties_missing',
      reason: `Some parties are not visible in the photo (${missing.join(', ')}). Fit the whole poster in the frame and take it again.`,
    };
  }

  // VER-08: arithmetic, using only totals actually printed on the poster
  const sum = Object.values(partyVotes).reduce((a, b) => a + b, 0);
  const figures: ResultFigures = {
    partyVotes,
    totalValid: reading.total_valid_votes ?? sum,
    rejected: reading.rejected_votes,
    totalCast: reading.total_votes_cast,
  };
  const problems: string[] = [];
  if (reading.total_valid_votes !== null && reading.total_valid_votes !== sum) {
    problems.push(`party scores add up to ${sum}, but total valid votes reads ${reading.total_valid_votes}`);
  }
  if (
    reading.total_valid_votes !== null &&
    reading.rejected_votes !== null &&
    reading.total_votes_cast !== null &&
    reading.total_valid_votes + reading.rejected_votes !== reading.total_votes_cast
  ) {
    problems.push(
      `valid (${reading.total_valid_votes}) plus rejected (${reading.rejected_votes}) votes do not equal total votes cast (${reading.total_votes_cast})`,
    );
  }
  if (problems.length) {
    return {
      outcome: 'needs_confirmation',
      unitCode: ctx.unit.code,
      figures,
      strength,
      flags,
      code: 'arithmetic_mismatch',
      reason: `Please check these figures against the poster: ${problems.join('; ')}.`,
    };
  }

  const notes = reading.notes.trim() ? [reading.notes.trim()] : [];
  if (!flags.stampVisible) notes.push('No stamp visible on the poster');
  return { outcome: 'verified', unitCode: ctx.unit.code, figures, strength, flags, notes };
}
