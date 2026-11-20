import { NIGERIAN_STATES, parseUnitCode } from '@trustelect/shared';

/**
 * CAP-06: typed figures in a short format, e.g. "PU 24-05-01-003 APC 112 LP 98 PDP 140".
 * Party acronyms are upper-cased; separators (commas, colons, equals signs) are optional.
 */
export function parseTypedFigures(text: string): { unitCode: string; votes: Record<string, number> } | { error: string } | null {
  const m = /^\s*PU[\s:.-]+(\d{1,2}[-/]\d{1,2}[-/]\d{1,2}[-/]\d{1,3})\s+([\s\S]+)$/i.exec(text);
  if (!m) return null;
  const unit = parseUnitCode(m[1]);
  if (!unit) return { error: `${m[1]} is not a valid polling unit code.` };
  const votes: Record<string, number> = {};
  const rest = m[2].replace(/([A-Za-z][A-Za-z0-9-]{0,9})\s*[:=]?\s*(\d{1,6})/g, (_all, party: string, n: string) => {
    const key = party.toUpperCase();
    if (key in votes) votes[`${key}#dup`] = 0;
    votes[key] = Number(n);
    return ' ';
  });
  if (rest.replace(/[\s,;.]/g, '') !== '') return { error: 'Write each party followed by its votes, for example APC 112 LP 98.' };
  if (Object.keys(votes).some((k) => k.endsWith('#dup'))) return { error: 'A party appears twice.' };
  if (!Object.keys(votes).length) return { error: 'No party figures found.' };
  return { unitCode: unit.unit, votes };
}

/** A polling unit, ward, LGA or state code anywhere in a message. Most specific first. */
export function findAreaCode(text: string): { level: 'polling_unit' | 'ward' | 'lga' | 'state'; code: string } | null {
  const unit = /\b(\d{1,2}[-/]\d{1,2}[-/]\d{1,2}[-/]\d{1,3})\b/.exec(text);
  if (unit) {
    const parsed = parseUnitCode(unit[1]);
    if (parsed) return { level: 'polling_unit', code: parsed.unit };
  }
  const pad = (s: string) => s.padStart(2, '0');
  const ward = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (ward) return { level: 'ward', code: `${pad(ward[1])}-${pad(ward[2])}-${pad(ward[3])}` };
  const lga = /\b(\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (lga) return { level: 'lga', code: `${pad(lga[1])}-${pad(lga[2])}` };
  return null;
}

/** Words that mean "send me the camera link" */
export const wantsCaptureLink = (text: string) => /^\s*(photo|picture|pic|camera|capture|link|snap|foto|hoto)\b/i.test(text);

export const wantsHelp = (text: string) => /^\s*(hi|hello|hey|help|menu|start|good (morning|afternoon|evening)|sannu|bawo|ndewo)\b/i.test(text);

/** INF-08: danger at the polling unit gets the emergency reply at once, whatever else the message says */
export const isEmergency = (text: string) =>
  /\b(attack(ed|ing)?|violence|violent|gun(s|shot|men)?|shoot(ing)?|shot|stab(bed)?|kill(ed|ing)?|thugs?|injur(ed|y)|bleeding|danger|emergency|fire|burn(ing)?|kidnap(ped)?|snatch(ed|ing)?)\b/i.test(text);

/** "this unit", "my polling unit", "that PU": the voter means the unit already discussed (INF-02) */
export const meansRememberedUnit = (text: string) =>
  /\b(this|my|that|the same|our)\s+(polling\s+)?(unit|pu|booth|station)\b/i.test(text) ||
  /\b(una|for)\s+(my|this)\s+(unit|pu)\b/i.test(text);

/** Every number in a text, in order: used to check a translation kept them unchanged */
export const numbersIn = (text: string) => (text.match(/\d+/g) ?? []).join(',');

const words = (text: string) => ` ${text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

const STATE_NAMES: { code: string; name: string }[] = [
  ...NIGERIAN_STATES.map((s) => ({ code: s.code, name: words(s.name) })),
  { code: '37', name: words('FCT') },
  { code: '37', name: words('Abuja') },
];

/**
 * A state or LGA named in a message ("what is the update in Edo?", "results for Oredo"),
 * for lookups without a code. The more specific LGA wins; a name shared by a state and one of
 * its LGAs (Ebonyi, Ekiti) means the state. Ambiguous LGA names give nothing.
 */
export function findPlace(text: string, lgas: { code: string; name: string }[]): { level: 'lga' | 'state'; code: string } | null {
  const t = words(text);
  const states = STATE_NAMES.filter((s) => t.includes(s.name));
  let candidates = lgas.filter((l) => {
    const n = words(l.name);
    return n.trim().length >= 3 && t.includes(n) && !states.some((s) => s.name === n);
  });
  if (states.length) candidates = candidates.filter((l) => states.some((s) => l.code.startsWith(`${s.code}-`)));
  if (candidates.length === 1) return { level: 'lga', code: candidates[0].code };
  const stateCodes = new Set(states.map((s) => s.code));
  if (stateCodes.size === 1) return { level: 'state', code: [...stateCodes][0] };
  return null;
}
