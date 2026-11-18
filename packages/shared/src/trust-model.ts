/**
 * Trust, counting and comparison model (Specification v2.0, Section 7).
 * Shared by the API (which applies the rules) and the web app (which labels them).
 */

/** Table 1: confidence of a version, by number of distinct witnesses. */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_THRESHOLDS = {
  /** Minimum distinct witnesses for each level. Tuned during testing. */
  low: 1,
  medium: 2,
  high: 4,
} as const satisfies Record<ConfidenceLevel, number>;

export function confidenceFor(witnesses: number): ConfidenceLevel | null {
  if (witnesses >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (witnesses >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  if (witnesses >= CONFIDENCE_THRESHOLDS.low) return 'low';
  return null;
}

/** Table 2: status of a polling unit after version selection. */
export const UNIT_STATUSES = [
  'not_confirmed', // no verified photograph yet
  'counted', // one version, or a clear lead
  'provisional', // close lead: counted, sent to review
  'disputed', // tie: not counted, sent to review
  'resolved', // decided by a reviewer
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** A clear lead needs at least this many times the nearest rival's witnesses. */
export const CLEAR_LEAD_RATIO = 2;

/** Statuses whose figures are included in citizen-collated totals. */
export const COUNTED_STATUSES: readonly UnitStatus[] = ['counted', 'provisional', 'resolved'];

/** Table 4: comparison status of an area against its declared result. */
export const COMPARISON_STATUSES = [
  'match',
  'match_so_far',
  'does_not_match',
  'possible_mismatch_low_confidence',
  'awaiting_data',
] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

/** Table 5: incident report labels. Never "true" or "fake". */
export const INCIDENT_LABELS = [
  'supported',
  'partly_supported',
  'not_supported',
  'unconfirmed',
  'under_review',
] as const;
export type IncidentLabel = (typeof INCIDENT_LABELS)[number];

/** Label shown next to every citizen-collated figure (Specification CNT-05). */
export const UNOFFICIAL_LABEL = 'Citizen-collated, unofficial';
