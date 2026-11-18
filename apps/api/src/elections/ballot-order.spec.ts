import { ballotOrder } from './elections.service.js';

describe('ballotOrder', () => {
  it('orders parties alphabetically by acronym regardless of input order', () => {
    expect(ballotOrder(['PDP', 'A', 'APC', 'LP', 'AA', 'ADC', 'NNPP'])).toEqual(['A', 'AA', 'ADC', 'APC', 'LP', 'NNPP', 'PDP']);
  });

  it('does not change the input array', () => {
    const input = ['PDP', 'APC'];
    ballotOrder(input);
    expect(input).toEqual(['PDP', 'APC']);
  });
});
