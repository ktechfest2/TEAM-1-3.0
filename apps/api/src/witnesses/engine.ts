import { createHash } from 'node:crypto';
import { CLEAR_LEAD_RATIO, confidenceFor, type ConfidenceLevel } from '@trustelect/shared';
import type { ResultFigures } from '../database/schema.js';

/**
 * Witness and confidence engine (Specification 6.3, Section 7). Pure: given the accepted
 * photos of one polling unit, works out the versions, their witnesses and confidence,
 * and which version is counted.
 */

export interface AcceptedPhoto {
  submissionId: string;
  reporterId: string;
  deviceHash: string | null;
  ipHash: string | null;
  figures: ResultFigures;
  strength: 'strong' | 'standard' | 'low';
}

export interface VersionSummary {
  /** Identity of the figures: identical party scores are one version (WIT-02) */
  figuresHash: string;
  figures: ResultFigures;
  submissionIds: string[];
  /** Distinct people: photos sharing a phone number or a device are one witness (WIT-03) */
  witnesses: number;
  stampedWitnesses: number;
  strongWitnesses: number;
  confidence: ConfidenceLevel;
}

export type UnitStatus = 'not_confirmed' | 'counted' | 'provisional' | 'disputed';

export interface UnitOutcome {
  status: UnitStatus;
  /** Null when nothing is counted (no photos, or a tie) */
  counted: VersionSummary | null;
  versions: VersionSummary[];
  flags: string[];
}

/** Witnesses sharing one network address beyond which a unit is flagged for review */
export const SHARED_NETWORK_FLAG_AT = 3;

/** Canonical hash of party scores; totals follow from them, and posters may omit some totals. */
export function figuresHash(figures: ResultFigures): string {
  const canonical = Object.entries(figures.partyVotes)
    .map(([party, votes]) => [party.toUpperCase(), votes] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Groups photos into witnesses: any shared phone number or device joins them (union-find). */
export function witnessGroups(photos: AcceptedPhoto[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of photos) {
    const phone = `phone:${p.reporterId}`;
    union(phone, phone);
    if (p.deviceHash) union(phone, `device:${p.deviceHash}`);
  }
  // submission id -> witness id
  return new Map(photos.map((p) => [p.submissionId, find(`phone:${p.reporterId}`)]));
}

export function computeUnit(photos: AcceptedPhoto[]): UnitOutcome {
  if (photos.length === 0) return { status: 'not_confirmed', counted: null, versions: [], flags: [] };

  const witnessOf = witnessGroups(photos);
  const byVersion = new Map<string, AcceptedPhoto[]>();
  for (const p of photos) {
    const key = figuresHash(p.figures);
    byVersion.set(key, [...(byVersion.get(key) ?? []), p]);
  }

  const versions: VersionSummary[] = [...byVersion.entries()].map(([hash, group]) => {
    const witnesses = new Map<string, AcceptedPhoto[]>();
    for (const p of group) {
      const w = witnessOf.get(p.submissionId)!;
      witnesses.set(w, [...(witnesses.get(w) ?? []), p]);
    }
    const stamped = [...witnesses.values()].filter((ps) => ps.some((p) => p.strength !== 'low')).length;
    const strong = [...witnesses.values()].filter((ps) => ps.some((p) => p.strength === 'strong')).length;
    // A version with no stamped photo at all stays at low confidence (decision of 19 Nov)
    const level = confidenceFor(witnesses.size) ?? 'low';
    const confidence: ConfidenceLevel = stamped === 0 ? 'low' : level;
    // Use the figures with the most totals filled in
    const figures = group
      .map((p) => p.figures)
      .sort((a, b) => Number(b.rejected !== null) + Number(b.totalCast !== null) - (Number(a.rejected !== null) + Number(a.totalCast !== null)))[0];
    return {
      figuresHash: hash,
      figures,
      submissionIds: group.map((p) => p.submissionId),
      witnesses: witnesses.size,
      stampedWitnesses: stamped,
      strongWitnesses: strong,
      confidence,
    };
  });
  versions.sort((a, b) => b.witnesses - a.witnesses || b.stampedWitnesses - a.stampedWitnesses || a.figuresHash.localeCompare(b.figuresHash));

  const flags: string[] = [];
  // Several witnesses on one network address: flag for review, never block (CGNAT is common)
  const ipWitnesses = new Map<string, Set<string>>();
  for (const p of photos) {
    if (!p.ipHash) continue;
    ipWitnesses.set(p.ipHash, (ipWitnesses.get(p.ipHash) ?? new Set()).add(witnessOf.get(p.submissionId)!));
  }
  if ([...ipWitnesses.values()].some((w) => w.size >= SHARED_NETWORK_FLAG_AT)) flags.push('shared_network');

  // Table 2: which version is counted
  const [leader, runnerUp] = versions;
  if (!runnerUp) return { status: 'counted', counted: leader, versions, flags };
  if (leader.witnesses === runnerUp.witnesses) return { status: 'disputed', counted: null, versions, flags };
  if (leader.witnesses >= CLEAR_LEAD_RATIO * runnerUp.witnesses) return { status: 'counted', counted: leader, versions, flags };
  return { status: 'provisional', counted: leader, versions, flags };
}
