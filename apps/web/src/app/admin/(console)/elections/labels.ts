export const ELECTION_TYPE_LABELS = {
  presidential: 'Presidential',
  governorship: 'Governorship',
  senate: 'Senate',
  house_of_representatives: 'House of Representatives',
  state_assembly: 'State House of Assembly',
  area_council: 'FCT Area Council',
  local_government: 'Local Government',
} as const;

export type ElectionType = keyof typeof ELECTION_TYPE_LABELS;
export type ElectionStatus = 'draft' | 'active' | 'closed';

export const STATUS_LABELS: Record<ElectionStatus, string> = {
  draft: 'Draft (hidden)',
  active: 'Active',
  closed: 'Closed',
};

export interface ElectionSummary {
  id: string;
  type: ElectionType;
  title: string;
  electionDate: string;
  scopeLevel: 'national' | 'state' | 'lga';
  scopeCode: string | null;
  pollsCloseAt: string;
  status: ElectionStatus;
  parties: number;
}
