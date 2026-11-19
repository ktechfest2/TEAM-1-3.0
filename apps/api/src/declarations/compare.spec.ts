import { compare, type CitizenFigures, type CompareInput } from './compare.js';

const ballot = ['APC', 'LP', 'PDP'];
const declared = { partyVotes: { APC: 500, LP: 300, PDP: 400 }, totalValid: 1200 };

const citizen = (over: Partial<CitizenFigures> = {}): CitizenFigures => ({
  partyVotes: { APC: 200, LP: 100, PDP: 150 },
  totalValid: 450,
  countedUnits: 4,
  totalUnits: 10,
  provisionalUnits: 0,
  disputedUnits: 0,
  ...over,
});

const input = (over: Partial<CompareInput> = {}): CompareInput => {
  const c = over.citizen ?? citizen();
  return {
    ballot,
    declarations: [declared],
    citizen: c,
    citizenExcludingLow: { partyVotes: c.partyVotes, totalValid: c.totalValid },
    ...over,
  };
};

describe('compare', () => {
  it('awaits data without an approved declaration or without counted units', () => {
    expect(compare(input({ declarations: [] })).status).toBe('awaiting_data');
    expect(compare(input({ citizen: citizen({ countedUnits: 0, partyVotes: {}, totalValid: 0 }) })).status).toBe('awaiting_data');
  });

  it('reports "match so far" when nothing counted is inconsistent at partial coverage', () => {
    const r = compare(input());
    expect(r).toMatchObject({ status: 'match_so_far', fullCoverage: false, disputeExists: false });
    expect(r.parties[0]).toEqual({ party: 'APC', declared: 500, citizen: 200, exceedsDeclared: false });
  });

  it('reports "match" when every unit is counted and every figure is equal', () => {
    const full = citizen({ partyVotes: declared.partyVotes, totalValid: 1200, countedUnits: 10 });
    expect(compare(input({ citizen: full })).status).toBe('match');
  });

  it('does not match when citizen-confirmed votes exceed the declared total for the area', () => {
    const c = citizen({ partyVotes: { APC: 200, LP: 350, PDP: 150 }, totalValid: 700 });
    const r = compare(input({ citizen: c }));
    expect(r.status).toBe('does_not_match');
    expect(r.parties.find((p) => p.party === 'LP')).toMatchObject({ exceedsDeclared: true });
    expect(r.reasons[0]).toMatch(/LP: citizen-confirmed polling units already show 350 votes, more than the 300 declared/);
  });

  it('does not match at full coverage when any figure differs, even downwards', () => {
    const full = citizen({ partyVotes: { APC: 480, LP: 300, PDP: 400 }, totalValid: 1180, countedUnits: 10 });
    const r = compare(input({ citizen: full }));
    expect(r.status).toBe('does_not_match');
    expect(r.reasons.join(' ')).toMatch(/APC: every polling unit is counted and shows 480 votes, but 500 were declared/);
  });

  it('treats a difference that rests only on low-confidence units as a possible mismatch', () => {
    const c = citizen({ partyVotes: { APC: 200, LP: 350, PDP: 150 }, totalValid: 700 });
    const r = compare(input({ citizen: c, citizenExcludingLow: { partyVotes: { APC: 150, LP: 250, PDP: 100 }, totalValid: 500 } }));
    expect(r.status).toBe('possible_mismatch_low_confidence');
  });

  it('flags that a dispute exists when disputed or provisional units are in the area', () => {
    expect(compare(input({ citizen: citizen({ disputedUnits: 1 }) })).disputeExists).toBe(true);
    expect(compare(input({ citizen: citizen({ provisionalUnits: 2 }) })).disputeExists).toBe(true);
  });

  it('pauses the comparison when two approved declarations disagree', () => {
    const other = { partyVotes: { APC: 501, LP: 300, PDP: 400 }, totalValid: 1201 };
    expect(compare(input({ declarations: [declared, other] })).status).toBe('conflicting_declarations');
    expect(compare(input({ declarations: [declared, { ...declared }] })).status).toBe('match_so_far');
  });

  it('does not match when unit figures listed in the declaration differ from what witnesses photographed', () => {
    const r = compare(input({ unitDifferences: [{ unitCode: '24-05-01-003', lowConfidence: false }] }));
    expect(r).toMatchObject({ status: 'does_not_match', unitDifferences: ['24-05-01-003'] });
    expect(compare(input({ unitDifferences: [{ unitCode: '24-05-01-003', lowConfidence: true }] })).status).toBe(
      'possible_mismatch_low_confidence',
    );
  });

  it('uses neutral wording only', () => {
    const c = citizen({ partyVotes: { APC: 900, LP: 100, PDP: 150 }, totalValid: 1150 });
    const text = compare(input({ citizen: c })).reasons.join(' ').toLowerCase();
    for (const word of ['rigged', 'fraud', 'fake', 'false', 'stolen']) expect(text).not.toContain(word);
  });
});
