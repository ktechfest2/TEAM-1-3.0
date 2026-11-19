import { decide, electionTypeFromText, normaliseParty, type DecisionContext } from './decide.js';
import type { Ec60eReading } from './reading.js';

const good: Ec60eReading = {
  is_ec60e: true,
  document_description: 'EC60E result poster',
  image_quality: 'good',
  stamp_visible: true,
  signature_present: true,
  election_type_on_form: 'Governorship',
  polling_unit_code: '24/05/01/003',
  polling_unit_name: 'BADAGRY ROAD',
  party_results: [
    { party: 'A.P.C', votes: 112, legible: true },
    { party: 'LP', votes: 98, legible: true },
    { party: 'PDP', votes: 140, legible: true },
  ],
  total_valid_votes: 350,
  rejected_votes: 9,
  total_votes_cast: 359,
  notes: '',
};

const ctx: DecisionContext = {
  election: { type: 'governorship', scopeLevel: 'state', scopeCode: '24', pollsCloseAt: new Date('2027-03-06T13:30:00Z') },
  ballot: ['APC', 'LP', 'PDP'],
  receivedAt: new Date('2027-03-06T18:00:00Z'),
  unit: { code: '24-05-01-003', wardCode: '24-05-01', lgaCode: '24-05', stateCode: '24' },
};

const with_ = (r: Partial<Ec60eReading>, c: Partial<DecisionContext> = {}) => decide({ ...good, ...r }, { ...ctx, ...c });

describe('decide', () => {
  it('verifies a clear, stamped, signed poster whose figures add up', () => {
    const d = decide(good, ctx);
    expect(d).toMatchObject({
      outcome: 'verified',
      unitCode: '24-05-01-003',
      figures: { partyVotes: { APC: 112, LP: 98, PDP: 140 }, totalValid: 350, rejected: 9, totalCast: 359 },
    });
  });

  it('rejects images that are not an EC60E', () => {
    expect(with_({ is_ec60e: false, document_description: 'an EC8A sheet' })).toMatchObject({ outcome: 'rejected', code: 'not_ec60e' });
  });

  it('asks for a retake when the photo is blurred, cropped, dark, glary or too far', () => {
    for (const q of ['blurred', 'cropped', 'too_dark', 'glare', 'too_far'] as const) {
      expect(with_({ image_quality: q })).toMatchObject({ outcome: 'retake', code: `quality_${q}` });
    }
  });

  it('requires the stamp and the signature', () => {
    expect(with_({ stamp_visible: false })).toMatchObject({ outcome: 'retake', code: 'no_stamp' });
    expect(with_({ signature_present: false })).toMatchObject({ outcome: 'retake', code: 'no_signature' });
  });

  it('rejects photos received before polls closed', () => {
    expect(with_({}, { receivedAt: new Date('2027-03-06T10:00:00Z') })).toMatchObject({ outcome: 'rejected', code: 'before_polls_close' });
  });

  it('checks the polling unit code against the register and the election area', () => {
    expect(with_({ polling_unit_code: null })).toMatchObject({ outcome: 'retake', code: 'unit_code_unreadable' });
    expect(with_({}, { unit: null })).toMatchObject({ outcome: 'retake', code: 'unit_not_in_register' });
    const kano = { code: '19-01-01-001', wardCode: '19-01-01', lgaCode: '19-01', stateCode: '19' };
    expect(with_({}, { unit: kano })).toMatchObject({ outcome: 'rejected', code: 'outside_election_area' });
    const national = { ...ctx.election, scopeLevel: 'national' as const, scopeCode: null, type: 'presidential' as const };
    expect(with_({ election_type_on_form: 'Presidential' }, { unit: kano, election: national })).toMatchObject({ outcome: 'verified' });
  });

  it('rejects a poster for a different election type, and ignores unrecognised wording', () => {
    expect(with_({ election_type_on_form: 'Senatorial' })).toMatchObject({ outcome: 'rejected', code: 'wrong_election' });
    expect(with_({ election_type_on_form: null })).toMatchObject({ outcome: 'verified' });
    expect(with_({ election_type_on_form: 'General' })).toMatchObject({ outcome: 'verified' });
  });

  it('asks for a retake when any figure is unreadable', () => {
    const rows = good.party_results.map((r, i) => (i === 1 ? { ...r, legible: false } : r));
    expect(with_({ party_results: rows })).toMatchObject({ outcome: 'retake', code: 'unreadable_figures' });
    const nulls = good.party_results.map((r, i) => (i === 2 ? { ...r, votes: null } : r));
    expect(with_({ party_results: nulls })).toMatchObject({ outcome: 'retake', code: 'unreadable_figures' });
  });

  it('matches parties to the ballot and flags unknown or missing parties', () => {
    expect(with_({ party_results: [...good.party_results, { party: 'XYZ', votes: 1, legible: true }] })).toMatchObject({
      outcome: 'rejected',
      code: 'party_not_on_ballot',
    });
    expect(with_({ party_results: good.party_results.slice(0, 2) })).toMatchObject({ outcome: 'retake', code: 'parties_missing' });
  });

  it('asks the voter to confirm when the arithmetic does not add up', () => {
    const d = with_({ total_valid_votes: 351 });
    expect(d).toMatchObject({ outcome: 'needs_confirmation', code: 'arithmetic_mismatch' });
    expect(with_({ total_votes_cast: 360 })).toMatchObject({ outcome: 'needs_confirmation' });
  });

  it('checks only the totals the poster actually shows', () => {
    const d = with_({ total_valid_votes: null, rejected_votes: null, total_votes_cast: null });
    expect(d).toMatchObject({ outcome: 'verified', figures: { totalValid: 350, rejected: null, totalCast: null } });
  });
});

describe('helpers', () => {
  it('recognises election types from printed wording', () => {
    expect(electionTypeFromText('PRESIDENTIAL ELECTION')).toBe('presidential');
    expect(electionTypeFromText('House of Representatives')).toBe('house_of_representatives');
    expect(electionTypeFromText('State House of Assembly')).toBe('state_assembly');
    expect(electionTypeFromText('FCT Area Council')).toBe('area_council');
    expect(electionTypeFromText(null)).toBeNull();
  });

  it('normalises party acronyms', () => {
    expect(normaliseParty('A.P.C.')).toBe('APC');
    expect(normaliseParty(' n n p p ')).toBe('NNPP');
  });
});
