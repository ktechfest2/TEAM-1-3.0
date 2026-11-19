import type { ComparisonStatus } from '@trustelect/shared';

/**
 * Compares an officially declared result with the citizen-collated figures for the same
 * area (Specification CMP-05 to CMP-10, Section 7 Table 4). Pure and neutral: it only says
 * whether the figures are consistent, never that a result is rigged or false.
 */

export interface DeclaredFigures {
  partyVotes: Record<string, number>;
  totalValid: number | null;
}

export interface CitizenFigures {
  partyVotes: Record<string, number>;
  totalValid: number;
  countedUnits: number;
  totalUnits: number;
  /** Units that could still change the picture */
  provisionalUnits: number;
  disputedUnits: number;
}

export interface PartyComparison {
  party: string;
  declared: number;
  citizen: number;
  /** Citizen-confirmed votes exceed the declared total: impossible if both are right */
  exceedsDeclared: boolean;
}

export interface Comparison {
  status: ComparisonStatus;
  /** Disputed or provisional units in the area could change the status */
  disputeExists: boolean;
  fullCoverage: boolean;
  parties: PartyComparison[];
  /** Plain-language reasons, neutral wording */
  reasons: string[];
  /** Polling units whose listed figures differ from their counted result (CMP-08) */
  unitDifferences: string[];
}

export interface CompareInput {
  ballot: string[];
  /** Approved declarations for this area; more than one with different figures is a conflict */
  declarations: DeclaredFigures[];
  citizen: CitizenFigures;
  /** The same citizen totals excluding low-confidence units */
  citizenExcludingLow: Pick<CitizenFigures, 'partyVotes' | 'totalValid'>;
  /** Per-unit figures listed in the declaration that differ from the unit's counted version */
  unitDifferences?: { unitCode: string; lowConfidence: boolean }[];
}

const same = (a: DeclaredFigures, b: DeclaredFigures, ballot: string[]) =>
  ballot.every((p) => (a.partyVotes[p] ?? 0) === (b.partyVotes[p] ?? 0)) && a.totalValid === b.totalValid;

function excess(ballot: string[], declared: DeclaredFigures, citizen: Pick<CitizenFigures, 'partyVotes' | 'totalValid'>) {
  const parties = ballot.filter((p) => (citizen.partyVotes[p] ?? 0) > (declared.partyVotes[p] ?? 0));
  const valid = declared.totalValid !== null && citizen.totalValid > declared.totalValid;
  return { parties, valid };
}

export function compare(input: CompareInput): Comparison {
  const { ballot, declarations, citizen } = input;
  const disputeExists = citizen.disputedUnits + citizen.provisionalUnits > 0;
  const fullCoverage = citizen.totalUnits > 0 && citizen.countedUnits === citizen.totalUnits;
  const base = { disputeExists, fullCoverage, unitDifferences: [] as string[] };

  if (declarations.length === 0) {
    return { ...base, status: 'awaiting_data', parties: [], reasons: ['No approved declaration for this area yet.'] };
  }
  const [declared] = declarations;
  if (declarations.some((d) => !same(d, declared, ballot))) {
    return {
      ...base,
      status: 'conflicting_declarations',
      parties: [],
      reasons: ['Two approved declarations for this area show different figures. The comparison is paused while they are reviewed.'],
    };
  }

  const parties: PartyComparison[] = ballot.map((p) => {
    const d = declared.partyVotes[p] ?? 0;
    const c = citizen.partyVotes[p] ?? 0;
    return { party: p, declared: d, citizen: c, exceedsDeclared: c > d };
  });

  if (citizen.countedUnits === 0) {
    return { ...base, status: 'awaiting_data', parties, reasons: ['No polling unit in this area has a counted citizen result yet.'] };
  }

  const reasons: string[] = [];
  const all = excess(ballot, declared, citizen);
  const strong = excess(ballot, declared, input.citizenExcludingLow);
  for (const p of all.parties) {
    reasons.push(
      `${p}: citizen-confirmed polling units already show ${citizen.partyVotes[p] ?? 0} votes, more than the ${declared.partyVotes[p] ?? 0} declared for the whole area.`,
    );
  }
  if (all.valid) {
    reasons.push(`Citizen-confirmed valid votes (${citizen.totalValid}) exceed the declared total (${declared.totalValid}).`);
  }

  // At full coverage every figure must be equal
  if (fullCoverage) {
    for (const p of ballot) {
      const d = declared.partyVotes[p] ?? 0;
      const c = citizen.partyVotes[p] ?? 0;
      if (c < d) reasons.push(`${p}: every polling unit is counted and shows ${c} votes, but ${d} were declared.`);
    }
    if (declared.totalValid !== null && citizen.totalValid < declared.totalValid) {
      reasons.push(`Every polling unit is counted and shows ${citizen.totalValid} valid votes, but ${declared.totalValid} were declared.`);
    }
  }

  const unitDiffs = input.unitDifferences ?? [];
  for (const u of unitDiffs) {
    reasons.push(`Polling unit ${u.unitCode}: the figures listed in the declaration differ from what witnesses photographed.`);
  }

  if (reasons.length === 0) {
    return {
      ...base,
      status: fullCoverage ? 'match' : 'match_so_far',
      parties,
      reasons: [
        fullCoverage
          ? 'Every polling unit is counted and the figures agree with the declaration.'
          : `Nothing in the ${citizen.countedUnits} counted polling units is inconsistent with the declaration.`,
      ],
    };
  }

  // Does the difference survive without low-confidence units?
  const fullCoverageDiffers = fullCoverage && reasons.length > all.parties.length + Number(all.valid) + unitDiffs.length;
  const strongEvidence =
    strong.parties.length > 0 || strong.valid || unitDiffs.some((u) => !u.lowConfidence) || fullCoverageDiffers;

  return {
    ...base,
    status: strongEvidence ? 'does_not_match' : 'possible_mismatch_low_confidence',
    parties,
    reasons: strongEvidence
      ? reasons
      : [...reasons, 'The difference depends on low-confidence polling units only. More witnesses could confirm or clear it.'],
    unitDifferences: unitDiffs.map((u) => u.unitCode),
  };
}
