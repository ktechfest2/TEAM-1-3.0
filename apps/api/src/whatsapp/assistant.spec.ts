import { isPartisan } from './assistant.js';

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
