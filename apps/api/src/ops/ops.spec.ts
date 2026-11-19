import { isSpike } from './ops.service.js';

describe('alert spikes', () => {
  it('needs a minimum and three times the usual rate', () => {
    expect(isSpike(4, 0, 5)).toBe(false); // below the minimum
    expect(isSpike(5, 0, 5)).toBe(true); // quiet before
    expect(isSpike(6, 8, 5)).toBe(true); // usual 2 per 30 min
    expect(isSpike(6, 12, 5)).toBe(false); // usual 3 per 30 min: 6 is only twice
    expect(isSpike(9, 12, 5)).toBe(true);
  });
});
