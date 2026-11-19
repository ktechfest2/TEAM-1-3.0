export type Mix = { high: number; medium: number; low: number; provisional: number; disputed: number; notConfirmed: number };

export type AreaTally = {
  code: string | null;
  name: string;
  totalUnits: number;
  countedUnits: number;
  mix: Mix;
  partyVotes: Record<string, number>;
  totalValid: number;
  rejected: number;
  rejectedReportedUnits: number;
  status?: string;
};

export type Level = 'national' | 'state' | 'lga' | 'ward';

export type TallyResponse = {
  election: { id: string; title: string; type: string; electionDate: string; status: string };
  parties: { acronym: string; name: string }[];
  area: { level: Level; code: string | null; name: string; path: { level: Level; code: string | null; name: string }[] };
  childLevel: 'state' | 'lga' | 'ward' | 'polling_unit';
  totals: AreaTally;
  children: AreaTally[];
  generatedAt: string;
};

export const CHILD_LABEL: Record<TallyResponse['childLevel'], string> = {
  state: 'State',
  lga: 'LGA',
  ward: 'Ward',
  polling_unit: 'Polling unit',
};

export const n = (v: number) => v.toLocaleString('en-NG');

export const pct = (part: number, whole: number) => {
  if (whole === 0 || part === 0) return '0%';
  const value = (100 * part) / whole;
  // Never show 0% when some units are counted
  return value < 0.1 ? '<0.1%' : `${value.toLocaleString('en-NG', { maximumFractionDigits: 1 })}%`;
};

export const CHILD_HEADING: Record<TallyResponse['childLevel'], string> = {
  state: 'By state',
  lga: 'By LGA',
  ward: 'By ward',
  polling_unit: 'By polling unit',
};
