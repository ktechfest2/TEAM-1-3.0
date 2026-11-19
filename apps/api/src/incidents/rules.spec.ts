import { decideLabel, newReference, type Assessment } from './rules.js';

const seen = (shows: Assessment['shows_claim'], extra: Partial<Assessment> = {}): Assessment => ({
  shows_claim: shows,
  signs_of_editing: false,
  screenshot_or_forwarded: false,
  identifies_private_person: false,
  description: '',
  ...extra,
});
const base = { type: 'late_officials' as const, channel: 'web' as const, reused: false, corroboration: 0 };

describe('incident labels (Table 5, INC-03 to INC-05)', () => {
  it('labels low-risk reports from the evidence and publishes them', () => {
    expect(decideLabel({ ...base, assessment: seen('yes') })).toEqual({ label: 'supported', suggested: 'supported', status: 'published' });
    expect(decideLabel({ ...base, assessment: seen('partly') }).label).toBe('partly_supported');
    expect(decideLabel({ ...base, assessment: seen('no') }).label).toBe('not_supported');
    expect(decideLabel({ ...base, assessment: seen('unclear') }).label).toBe('unconfirmed');
    expect(decideLabel({ ...base, assessment: null }).label).toBe('unconfirmed');
  });

  it('never supports reused or edited images', () => {
    expect(decideLabel({ ...base, assessment: seen('yes'), reused: true }).label).toBe('not_supported');
    expect(decideLabel({ ...base, assessment: seen('yes', { signs_of_editing: true }) }).label).toBe('not_supported');
  });

  it('weights WhatsApp and screenshots below live web photos unless others confirm', () => {
    expect(decideLabel({ ...base, channel: 'whatsapp', assessment: seen('yes') }).label).toBe('partly_supported');
    expect(decideLabel({ ...base, assessment: seen('yes', { screenshot_or_forwarded: true }) }).label).toBe('partly_supported');
    expect(decideLabel({ ...base, channel: 'whatsapp', assessment: seen('yes'), corroboration: 1 }).label).toBe('supported');
  });

  it('raises the label when independent people report the same thing', () => {
    expect(decideLabel({ ...base, assessment: seen('unclear'), corroboration: 2 }).label).toBe('partly_supported');
    expect(decideLabel({ ...base, assessment: seen('partly'), corroboration: 2 }).label).toBe('supported');
  });

  it('holds serious reports for a person whatever the AI says', () => {
    for (const type of ['intimidation_violence', 'ballot_snatching', 'vote_buying', 'other'] as const) {
      expect(decideLabel({ ...base, type, assessment: seen('yes') })).toEqual({ label: 'under_review', suggested: 'supported', status: 'held' });
    }
    expect(decideLabel({ ...base, assessment: seen('yes', { identifies_private_person: true }) }).status).toBe('held');
  });

  it('makes reference numbers without look-alike characters', () => {
    const ref = newReference((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(ref).toMatch(/^TE-[A-HJ-NP-Z2-9]{6}$/);
  });
});
