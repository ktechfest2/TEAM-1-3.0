import { findAreaCode, findPlace, isEmergency, meansRememberedUnit, numbersIn, parseTypedFigures, wantsCaptureLink } from './parse.js';

describe('typed figures (CAP-06)', () => {
  it('reads the short format, in any case and with separators', () => {
    expect(parseTypedFigures('PU 24-05-01-003 APC 112 LP 98 PDP 140')).toEqual({ unitCode: '24-05-01-003', votes: { APC: 112, LP: 98, PDP: 140 } });
    expect(parseTypedFigures('pu: 24/5/1/3 apc=112, lp: 98; pdp 140')).toEqual({ unitCode: '24-05-01-003', votes: { APC: 112, LP: 98, PDP: 140 } });
  });

  it('explains what is wrong instead of guessing', () => {
    expect(parseTypedFigures('PU 24-05-01-003 APC 112 LP')).toMatchObject({ error: expect.stringMatching(/each party followed by its votes/) });
    expect(parseTypedFigures('PU 24-05-01-003 APC 112 APC 98')).toMatchObject({ error: 'A party appears twice.' });
    expect(parseTypedFigures('PU 99-05-01-003 APC 1')).toMatchObject({ error: expect.stringMatching(/not a valid/) });
    expect(parseTypedFigures('hello there')).toBeNull();
  });
});

describe('message understanding without the model', () => {
  it('finds the most specific code', () => {
    expect(findAreaCode('result for 24-05-01-003 please')).toEqual({ level: 'polling_unit', code: '24-05-01-003' });
    expect(findAreaCode('ward 24-5-1')).toEqual({ level: 'ward', code: '24-05-01' });
    expect(findAreaCode('LGA 24-05')).toEqual({ level: 'lga', code: '24-05' });
    expect(findAreaCode('no code here')).toBeNull();
  });

  it('spots danger and capture requests', () => {
    expect(isEmergency('thugs are snatching the ballot box')).toBe(true);
    expect(isEmergency('what time do polls close')).toBe(false);
    expect(wantsCaptureLink('PHOTO')).toBe(true);
    expect(wantsCaptureLink('my photo id')).toBe(false);
    expect(wantsCaptureLink('send the result')).toBe(false);
  });

  it('recognises questions about the unit already discussed', () => {
    expect(meansRememberedUnit('is there any activity happening in this polling unit?')).toBe(true);
    expect(meansRememberedUnit('any update for my PU')).toBe(true);
    expect(meansRememberedUnit('what do I need to vote?')).toBe(false);
  });

  it('lists numbers so a translation that changes them can be rejected', () => {
    expect(numbersIn('APC 112 · LP 98, 24-05-01-003')).toBe('112,98,24,05,01,003');
  });
});

describe('findPlace', () => {
  const lgaList = [
    { code: '12-12', name: 'OREDO' },
    { code: '12-01', name: 'AKOKO EDO' },
    { code: '11-05', name: 'EBONYI' },
    { code: '24-23', name: 'SURULERE' },
    { code: '31-27', name: 'SURULERE' },
    { code: '24-05', name: 'APAPA' },
  ];
  it.each([
    ['what is election update in edo?', { level: 'state', code: '12' }],
    ['Results for Edo State', { level: 'state', code: '12' }],
    ['how far oredo?', { level: 'lga', code: '12-12' }],
    ['update for Oredo, Edo', { level: 'lga', code: '12-12' }],
    ['wetin dey happen for Ebonyi', { level: 'state', code: '11' }],
    ['results in abuja', { level: 'state', code: '37' }],
    ['Surulere Lagos results', { level: 'lga', code: '24-23' }],
    ['Akoko-Edo result', { level: 'lga', code: '12-01' }],
  ])('%s', (text, expected) => {
    expect(findPlace(text, lgaList)).toEqual(expected);
  });
  it.each(['any update for surulere?', 'what is happening?', 'my unit result'])('finds nothing in "%s"', (text) => {
    expect(findPlace(text, lgaList)).toBeNull();
  });
});
