import { createHash } from 'node:crypto';
import { CLEAR_LEAD_RATIO, confidenceFor, type ConfidenceLevel } from '@trustelect/shared';
import type { ResultFigures } from '../database/schema.js';
import { hamming, SAME_PICTURE_DISTANCE } from '../fraud/dhash.js';

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
  /** Sprint 13 anti-fraud signals (optional: older photos lack them) */
  imageSha256?: string | null;
  imageDhash?: string | null;
  receivedAt?: number;
  location?: { lat: number; lng: number } | null;
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
/** Different numbers sending the same unit from one network within this time: a burst */
export const BURST_WINDOW_MS = 120_000;
export const BURST_FLAG_AT = 3;
/** A capture this far from the other witnesses at the unit is out of area */
export const OUT_OF_AREA_KM = 3;

/** Roughly Nigeria (with a margin); captures outside it are out of area */
const NIGERIA = { minLat: 3.9, maxLat: 14.1, minLng: 2.5, maxLng: 14.9 };

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Photos taken far from where the other witnesses stood, or outside Nigeria. Needs at least
 * three located photos to say where "the others" are. Without unit coordinates in the register
 * this is relative; it becomes absolute once coordinates are loaded.
 */
export function outOfArea(photos: AcceptedPhoto[]): Set<string> {
  const located = photos.filter((p) => p.location);
  const out = new Set<string>();
  for (const p of located) {
    const { lat, lng } = p.location!;
    if (lat < NIGERIA.minLat || lat > NIGERIA.maxLat || lng < NIGERIA.minLng || lng > NIGERIA.maxLng) out.add(p.submissionId);
  }
  const inside = located.filter((p) => !out.has(p.submissionId));
  if (inside.length >= 3) {
    for (const p of inside) {
      const others = inside.filter((o) => o.reporterId !== p.reporterId);
      if (others.length < 2) continue;
      const centre = { lat: median(others.map((o) => o.location!.lat)), lng: median(others.map((o) => o.location!.lng)) };
      if (distanceKm(p.location!, centre) > OUT_OF_AREA_KM) out.add(p.submissionId);
    }
  }
  return out;
}

/** Different numbers that sent the same picture (same bytes, or the same picture re-saved) */
export function samePicturePairs(photos: AcceptedPhoto[]): [AcceptedPhoto, AcceptedPhoto][] {
  const pairs: [AcceptedPhoto, AcceptedPhoto][] = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const a = photos[i];
      const b = photos[j];
      if (a.reporterId === b.reporterId) continue;
      const sameBytes = !!a.imageSha256 && a.imageSha256 === b.imageSha256;
      const samePicture = !!a.imageDhash && !!b.imageDhash && hamming(a.imageDhash, b.imageDhash) <= SAME_PICTURE_DISTANCE;
      if (sameBytes || samePicture) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Canonical hash of party scores; totals follow from them, and posters may omit some totals. */
export function figuresHash(figures: ResultFigures): string {
  const canonical = Object.entries(figures.partyVotes)
    .map(([party, votes]) => [party.toUpperCase(), votes] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Groups photos into witnesses: any shared phone number, device or picture joins them
 * (union-find). One person with several SIMs on one phone, or sending one picture from several
 * numbers, is one witness (Sprint 13).
 */
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
  for (const [a, b] of samePicturePairs(photos)) union(`phone:${a.reporterId}`, `phone:${b.reporterId}`);
  // submission id -> witness id
  return new Map(photos.map((p) => [p.submissionId, find(`phone:${p.reporterId}`)]));
}

export function computeUnit(photos: AcceptedPhoto[]): UnitOutcome {
  if (photos.length === 0) return { status: 'not_confirmed', counted: null, versions: [], flags: [] };

  // Out-of-area captures keep their figures but lose their stamp credit, and are flagged
  const away = outOfArea(photos);
  photos = photos.map((p) => (away.has(p.submissionId) ? { ...p, strength: 'low' as const } : p));
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
  if (samePicturePairs(photos).length) flags.push('same_picture_several_numbers');
  if (away.size) flags.push('out_of_area');
  // Burst: several different numbers on one network within two minutes
  const byIp = new Map<string, AcceptedPhoto[]>();
  for (const p of photos) if (p.ipHash && p.receivedAt) byIp.set(p.ipHash, [...(byIp.get(p.ipHash) ?? []), p]);
  for (const group of byIp.values()) {
    const sorted = group.sort((a, b) => a.receivedAt! - b.receivedAt!);
    const burst = sorted.some(
      (p) => new Set(sorted.filter((q) => q.receivedAt! >= p.receivedAt! && q.receivedAt! - p.receivedAt! <= BURST_WINDOW_MS).map((q) => q.reporterId)).size >= BURST_FLAG_AT,
    );
    if (burst) {
      flags.push('burst');
      break;
    }
  }

  // Table 2: which version is counted
  const [leader, runnerUp] = versions;
  if (!runnerUp) return { status: 'counted', counted: leader, versions, flags };
  if (leader.witnesses === runnerUp.witnesses) return { status: 'disputed', counted: null, versions, flags };
  if (leader.witnesses >= CLEAR_LEAD_RATIO * runnerUp.witnesses) return { status: 'counted', counted: leader, versions, flags };
  return { status: 'provisional', counted: leader, versions, flags };
}
