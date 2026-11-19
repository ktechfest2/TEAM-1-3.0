import { parseUnitCode } from '@trustelect/shared';

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
