/** Levels at which results are collated, from smallest to largest. */
export const AREA_LEVELS = ['polling_unit', 'ward', 'lga', 'state', 'national'] as const;
export type AreaLevel = (typeof AREA_LEVELS)[number];

/** Levels at which an official declaration can be recorded (Specification CMP-01). */
export const DECLARATION_LEVELS = ['ward', 'lga', 'state', 'national'] as const;
export type DeclarationLevel = (typeof DECLARATION_LEVELS)[number];

/** INEC state codes: the first segment of every polling unit code. */
export const NIGERIAN_STATES = [
  { code: '01', name: 'Abia' },
  { code: '02', name: 'Adamawa' },
  { code: '03', name: 'Akwa Ibom' },
  { code: '04', name: 'Anambra' },
  { code: '05', name: 'Bauchi' },
  { code: '06', name: 'Bayelsa' },
  { code: '07', name: 'Benue' },
  { code: '08', name: 'Borno' },
  { code: '09', name: 'Cross River' },
  { code: '10', name: 'Delta' },
  { code: '11', name: 'Ebonyi' },
  { code: '12', name: 'Edo' },
  { code: '13', name: 'Ekiti' },
  { code: '14', name: 'Enugu' },
  { code: '15', name: 'Gombe' },
  { code: '16', name: 'Imo' },
  { code: '17', name: 'Jigawa' },
  { code: '18', name: 'Kaduna' },
  { code: '19', name: 'Kano' },
  { code: '20', name: 'Katsina' },
  { code: '21', name: 'Kebbi' },
  { code: '22', name: 'Kogi' },
  { code: '23', name: 'Kwara' },
  { code: '24', name: 'Lagos' },
  { code: '25', name: 'Nasarawa' },
  { code: '26', name: 'Niger' },
  { code: '27', name: 'Ogun' },
  { code: '28', name: 'Ondo' },
  { code: '29', name: 'Osun' },
  { code: '30', name: 'Oyo' },
  { code: '31', name: 'Plateau' },
  { code: '32', name: 'Rivers' },
  { code: '33', name: 'Sokoto' },
  { code: '34', name: 'Taraba' },
  { code: '35', name: 'Yobe' },
  { code: '36', name: 'Zamfara' },
  { code: '37', name: 'Federal Capital Territory' },
] as const;

export interface UnitCodeParts {
  /** Full normalised code, for example 24-05-11-003 */
  unit: string;
  state: string;
  lga: string;
  ward: string;
}

/**
 * Parses a polling unit code written with dashes or slashes (24-05-11-003, 24/05/11/003,
 * 24/5/11/3) into normalised codes for each level. Returns null if it is not a valid code.
 */
export function parseUnitCode(input: string): UnitCodeParts | null {
  const parts = input.trim().split(/[-/\s]+/);
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const [s, l, w, u] = parts.map(Number);
  if (s < 1 || s > 37 || l < 1 || w < 1 || u < 1 || l > 99 || w > 99 || u > 999) return null;
  const state = String(s).padStart(2, '0');
  const lga = `${state}-${String(l).padStart(2, '0')}`;
  const ward = `${lga}-${String(w).padStart(2, '0')}`;
  return { unit: `${ward}-${String(u).padStart(3, '0')}`, state, lga, ward };
}
