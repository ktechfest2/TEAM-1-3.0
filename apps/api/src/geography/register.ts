import { parseUnitCode } from '@trustelect/shared';
import { parseCsvRecords } from './csv.js';

/**
 * Normalised polling unit register row.
 *
 * Expected CSV columns (header names, any order):
 *   pu_code, pu_name, ward_name, lga_name, state_name
 * Optional:
 *   latitude, longitude, registered_voters
 */
export interface RegisterRow {
  unitCode: string;
  stateCode: string;
  lgaCode: string;
  wardCode: string;
  unitName: string;
  wardName: string;
  lgaName: string;
  stateName: string;
  latitude: number | null;
  longitude: number | null;
  registeredVoters: number | null;
}

export interface RegisterParseResult {
  rows: RegisterRow[];
  errors: { line: number; message: string }[];
}

const REQUIRED = ['pu_code', 'pu_name', 'ward_name', 'lga_name', 'state_name'] as const;

function optionalNumber(value: string | undefined, min: number, max: number): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function parseRegister(csv: string): RegisterParseResult {
  const records = parseCsvRecords(csv);
  const rows: RegisterRow[] = [];
  const errors: RegisterParseResult['errors'] = [];
  const seen = new Set<string>();

  const first = records[0];
  if (first) {
    const missing = REQUIRED.filter((k) => !(k in first));
    if (missing.length) {
      return { rows, errors: [{ line: 1, message: `Missing columns: ${missing.join(', ')}` }] };
    }
  }

  records.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const codes = parseUnitCode(r.pu_code ?? '');
    if (!codes) return errors.push({ line, message: `Invalid polling unit code "${r.pu_code}"` });
    const missing = REQUIRED.filter((k) => !r[k]);
    if (missing.length) return errors.push({ line, message: `Empty ${missing.join(', ')}` });
    if (seen.has(codes.unit)) return errors.push({ line, message: `Duplicate polling unit ${codes.unit}` });
    seen.add(codes.unit);

    rows.push({
      unitCode: codes.unit,
      stateCode: codes.state,
      lgaCode: codes.lga,
      wardCode: codes.ward,
      unitName: r.pu_name,
      wardName: r.ward_name,
      lgaName: r.lga_name,
      stateName: r.state_name,
      latitude: optionalNumber(r.latitude, 3, 15),
      longitude: optionalNumber(r.longitude, 2, 16),
      registeredVoters: optionalNumber(r.registered_voters, 0, 100_000),
    });
  });

  return { rows, errors };
}
