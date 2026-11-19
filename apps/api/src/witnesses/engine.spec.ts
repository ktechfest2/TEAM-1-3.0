import type { ResultFigures } from '../database/schema.js';
import { computeUnit, figuresHash, witnessGroups, type AcceptedPhoto } from './engine.js';

const A: ResultFigures = { partyVotes: { APC: 120, PDP: 80 }, totalValid: 200, rejected: null, totalCast: null };
const B: ResultFigures = { partyVotes: { APC: 80, PDP: 120 }, totalValid: 200, rejected: null, totalCast: null };

let n = 0;
const photo = (reporter: string, figures = A, over: Partial<AcceptedPhoto> = {}): AcceptedPhoto => ({
  submissionId: `s${++n}`,
  reporterId: reporter,
  deviceHash: `d-${reporter}`,
  ipHash: `ip-${reporter}`,
  figures,
  strength: 'standard',
  ...over,
});

describe('figuresHash', () => {
  it('identifies versions by party scores only, ignoring order, case and optional totals', () => {
    expect(figuresHash(A)).toBe(figuresHash({ ...A, rejected: 5, totalCast: 205 }));
    expect(figuresHash(A)).toBe(figuresHash({ ...A, partyVotes: { pdp: 80, apc: 120 } }));
    expect(figuresHash(A)).not.toBe(figuresHash(B));
  });
});

describe('witnessGroups', () => {
  it('merges photos that share a phone number or a device', () => {
    const photos = [
      photo('r1', A, { deviceHash: 'd1' }),
      photo('r2', A, { deviceHash: 'd1' }), // second SIM on the same phone
      photo('r3', A, { deviceHash: 'd2' }),
      photo('r3', A, { deviceHash: 'd3' }), // same number on another phone
      photo('r4', A, { deviceHash: 'd3' }), // ... which another number also used
    ];
    const groups = witnessGroups(photos);
    const ids = photos.map((p) => groups.get(p.submissionId));
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[3]).toBe(ids[4]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('computeUnit', () => {
  it('has nothing to count without photos', () => {
    expect(computeUnit([])).toMatchObject({ status: 'not_confirmed', counted: null });
  });

  it('counts a single version, with confidence from distinct witnesses (1 low, 2-3 medium, 4+ high)', () => {
    expect(computeUnit([photo('r1')])).toMatchObject({ status: 'counted', counted: { witnesses: 1, confidence: 'low' } });
    expect(computeUnit([photo('r1'), photo('r2'), photo('r3')]).counted).toMatchObject({ witnesses: 3, confidence: 'medium' });
    expect(computeUnit(['r1', 'r2', 'r3', 'r4'].map((r) => photo(r))).counted).toMatchObject({ witnesses: 4, confidence: 'high' });
  });

  it('counts several photos from one person, or from one device, as one witness', () => {
    const samePerson = [photo('r1'), photo('r1'), photo('r1'), photo('r1')];
    expect(computeUnit(samePerson).counted).toMatchObject({ witnesses: 1, confidence: 'low' });
    const sameDevice = ['r1', 'r2', 'r3', 'r4'].map((r) => photo(r, A, { deviceHash: 'one-phone' }));
    expect(computeUnit(sameDevice).counted).toMatchObject({ witnesses: 1, confidence: 'low' });
  });

  it('keeps a version with no stamped photo at low confidence, however many witnesses', () => {
    const unstamped = ['r1', 'r2', 'r3', 'r4', 'r5'].map((r) => photo(r, A, { strength: 'low' }));
    expect(computeUnit(unstamped).counted).toMatchObject({ witnesses: 5, stampedWitnesses: 0, confidence: 'low' });
    const oneStamped = [...unstamped, photo('r6', A, { strength: 'strong' })];
    expect(computeUnit(oneStamped).counted).toMatchObject({ witnesses: 6, stampedWitnesses: 1, strongWitnesses: 1, confidence: 'high' });
  });

  it('counts a clear lead (at least twice the runner-up)', () => {
    const photos = [photo('r1'), photo('r2'), photo('r3', B)];
    expect(computeUnit(photos)).toMatchObject({ status: 'counted', counted: { figures: A, witnesses: 2 } });
  });

  it('marks a close lead as provisional', () => {
    const photos = [photo('r1'), photo('r2'), photo('r3'), photo('r4', B), photo('r5', B)];
    expect(computeUnit(photos)).toMatchObject({ status: 'provisional', counted: { figures: A, witnesses: 3 } });
  });

  it('marks a tie as disputed and counts nothing', () => {
    const photos = [photo('r1'), photo('r2'), photo('r3', B), photo('r4', B)];
    const outcome = computeUnit(photos);
    expect(outcome).toMatchObject({ status: 'disputed', counted: null });
    expect(outcome.versions).toHaveLength(2);
  });

  it('cannot be outvoted by one person using many numbers on one phone', () => {
    const honest = [photo('r1'), photo('r2')];
    const faker = ['f1', 'f2', 'f3', 'f4', 'f5'].map((r) => photo(r, B, { deviceHash: 'faker-phone' }));
    expect(computeUnit([...honest, ...faker])).toMatchObject({ status: 'counted', counted: { figures: A, witnesses: 2 } });
  });

  it('flags several witnesses on one network address for review, without changing the count', () => {
    const photos = ['r1', 'r2', 'r3'].map((r) => photo(r, A, { ipHash: 'shared' }));
    expect(computeUnit(photos)).toMatchObject({ status: 'counted', flags: ['shared_network'], counted: { witnesses: 3 } });
    expect(computeUnit(photos.slice(0, 2)).flags).toEqual([]);
  });

  it('prefers the figures that include printed totals', () => {
    const withTotals = { ...A, rejected: 5, totalCast: 205 };
    expect(computeUnit([photo('r1'), photo('r2', withTotals)]).counted!.figures).toEqual(withTotals);
  });
});
