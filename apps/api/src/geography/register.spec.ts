import { parseUnitCode } from '@trustelect/shared';
import { parseCsv } from './csv.js';
import { parseRegister } from './register.js';

describe('parseUnitCode', () => {
  it('normalises dashes, slashes and missing zero padding', () => {
    expect(parseUnitCode('24-05-11-003')).toEqual({ unit: '24-05-11-003', state: '24', lga: '24-05', ward: '24-05-11' });
    expect(parseUnitCode('24/5/11/3')?.unit).toBe('24-05-11-003');
    expect(parseUnitCode(' 01/02/03/004 ')?.unit).toBe('01-02-03-004');
  });

  it('rejects malformed codes and unknown states', () => {
    expect(parseUnitCode('24-05-11')).toBeNull();
    expect(parseUnitCode('abc')).toBeNull();
    expect(parseUnitCode('38-01-01-001')).toBeNull();
    expect(parseUnitCode('24-00-11-003')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF and BOM', () => {
    const csv = '﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",2\n';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
  });
});

describe('parseRegister', () => {
  const header = 'pu_code,pu_name,ward_name,lga_name,state_name,latitude,longitude';

  it('parses valid rows and derives the ward, LGA and state codes', () => {
    const { rows, errors } = parseRegister(`${header}\n24/5/11/3,"Sample School, Gate",Sample Ward,Sample LGA,Lagos,6.5,3.3\n`);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      unitCode: '24-05-11-003',
      wardCode: '24-05-11',
      lgaCode: '24-05',
      stateCode: '24',
      unitName: 'Sample School, Gate',
      latitude: 6.5,
      longitude: 3.3,
    });
  });

  it('reports bad codes, empty names and duplicates with line numbers', () => {
    const csv = `${header}\nbad,A,W,L,S\n24-05-11-001,,W,L,S\n24-05-11-002,B,W,L,S\n24/05/11/002,C,W,L,S\n`;
    const { rows, errors } = parseRegister(csv);
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 5]);
  });

  it('rejects files without the required columns', () => {
    expect(parseRegister('code,name\n1,2\n').errors[0].message).toMatch(/Missing columns/);
  });

  it('ignores coordinates outside Nigeria', () => {
    const { rows } = parseRegister(`${header}\n24-05-11-001,A,W,L,S,51.5,-0.1\n`);
    expect(rows[0].latitude).toBeNull();
    expect(rows[0].longitude).toBeNull();
  });
});
