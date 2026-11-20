import { isGrounded, isPartisan } from './assistant.js';

describe('partisan filter (INF-08)', () => {
  it('blocks advice for a party and predictions', () => {
    expect(isPartisan('You should vote for APC.')).toBe(true);
    expect(isPartisan('Support the PDP this time')).toBe(true);
    expect(isPartisan('LP will win this election')).toBe(true);
    expect(isPartisan('The best candidate is the one from Lagos')).toBe(true);
  });

  it('lets neutral answers through, including Pidgin', () => {
    expect(isPartisan('Carry your PVC go vote for the polling unit where you register.')).toBe(false);
    expect(isPartisan('You vote for the candidate of your choice; your vote is secret.')).toBe(false);
    expect(isPartisan('TrustElect does not predict who will win.')).toBe(false);
  });
});

describe('isGrounded', () => {
  const data = 'Edo (12)\nCounted from 869 of 4,519 polling units\nAPC 63,331 · PDP 78,239 · LP 11,835\nCitizen-collated, unofficial.';
  it('accepts figures taken from the data, with or without separators', () => {
    expect(isGrounded('So far 869 of 4,519 units are counted: APC 63331, PDP 78,239 and LP 11,835 (unofficial).', data)).toBe(true);
  });
  it('refuses a figure that is not in the data', () => {
    expect(isGrounded('About 19% of units are counted.', data)).toBe(false);
    expect(isGrounded('PDP has 78,240 votes.', data)).toBe(false);
  });
  it('refuses talk of who is ahead', () => {
    expect(isGrounded('PDP is leading with 78,239 votes.', data)).toBe(false);
    expect(isGrounded('PDP dey lead for Edo.', data)).toBe(false);
  });
});
