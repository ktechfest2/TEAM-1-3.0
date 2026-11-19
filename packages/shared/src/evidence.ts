/**
 * Tamper evidence (EVD-02 to EVD-05): canonical records, the hash chain, evidence packs
 * and the public check. Used by the API (to write the chain and build packs) and by the
 * browser (to verify packs), so both compute exactly the same hashes.
 */

export const GENESIS_HASH = '0'.repeat(64);
export const PACK_FORMAT = 'trustelect-evidence-pack/1';

/** Record types written to the chain. Audit entries are chained but never published in packs. */
export type ChainEntryType = 'submission' | 'unit_result' | 'declaration' | 'audit';

/** One chain entry without its payload: this is what the public chain listing shows. */
export interface ChainEntry {
  seq: number;
  entryType: ChainEntryType;
  refId: string;
  payloadSha256: string;
  prevHash: string;
  hash: string;
  createdAt: string;
}

/** A chain entry with the canonical record it commits to (as included in evidence packs). */
export interface PackEntry extends ChainEntry {
  payload: string;
}

export interface PackRecord {
  entryType: ChainEntryType;
  refId: string;
  /** The record as stored now; must equal the latest chained version */
  current: unknown;
}

export interface PackManifest {
  format: typeof PACK_FORMAT;
  generatedAt: string;
  election: { id: string; title: string };
  area: { level: 'polling_unit' | 'ward'; code: string; name: string };
  /** Latest chain entry when the pack was made */
  chainHead: { seq: number; hash: string } | null;
  records: PackRecord[];
  /** Photo file name in the pack, by SHA-256 */
  photos: Record<string, string>;
  /** Comparison with approved declarations at the time (informational, not chained) */
  comparison: unknown;
}

/** JSON with sorted keys and no spacing, so the same record always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number in record');
    return JSON.stringify(value) ?? 'null';
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The text an entry's hash is computed over. */
export function entryHashInput(e: Omit<ChainEntry, 'hash'>): string {
  return [e.seq, e.entryType, e.refId, e.payloadSha256, e.prevHash, e.createdAt].join('|');
}

/** Text of a published anchor record (EVD-03), the file that is timestamped externally. */
export function anchorRecordText(a: { seq: number; hash: string; createdAt: string }): string {
  return `TrustElect hash chain anchor\nseq: ${a.seq}\nhash: ${a.hash}\npublished: ${a.createdAt}\n`;
}

/* ------------------------------------------------------------------ */
/* ZIP (stored entries only; packs are photos that are already compressed) */
/* ------------------------------------------------------------------ */

export function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged ZIP directory');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLength));
    if (method !== 0) throw new Error('This is not a TrustElect evidence pack (compressed entries)');
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Damaged ZIP entry');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, data.subarray(start, start + size));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* Public check of an evidence pack (EVD-05)                           */
/* ------------------------------------------------------------------ */

export type CheckStatus = 'pass' | 'fail' | 'warn';
export interface Check {
  status: CheckStatus;
  title: string;
  detail: string;
}

export interface PublishedChain {
  /** Chain entries (no payloads) from `from` up to the current head, in order */
  entries(from: number): Promise<ChainEntry[]>;
  /** Published anchors, newest first */
  anchors(): Promise<{ seq: number; hash: string; createdAt: string }[]>;
}

export interface VerifyResult {
  ok: boolean;
  checks: Check[];
  manifest: PackManifest | null;
}

/**
 * Checks a pack: every record hashes to its chain entry, entries link up to the published
 * chain and its anchors, the current records equal their latest chained versions, and every
 * photograph matches its recorded hash. Any change to a stored record makes one of these fail.
 */
export async function verifyPack(zip: Uint8Array, chain: PublishedChain): Promise<VerifyResult> {
  const checks: Check[] = [];
  const fail = (title: string, detail: string) => checks.push({ status: 'fail', title, detail });
  const done = (manifest: PackManifest | null) => ({ ok: !checks.some((c) => c.status === 'fail'), checks, manifest });

  let files: Map<string, Uint8Array>;
  let manifest: PackManifest;
  let packEntries: PackEntry[];
  try {
    files = readZip(zip);
    const text = (name: string) => {
      const f = files.get(name);
      if (!f) throw new Error(`${name} is missing`);
      return new TextDecoder().decode(f);
    };
    manifest = JSON.parse(text('manifest.json')) as PackManifest;
    packEntries = JSON.parse(text('chain.json')) as PackEntry[];
    if (manifest.format !== PACK_FORMAT) throw new Error('Unknown pack format');
  } catch (err) {
    fail('Readable evidence pack', (err as Error).message);
    return done(null);
  }

  // 1. Each record in the pack hashes to its chain entry
  let bad = 0;
  for (const e of packEntries) {
    const payloadOk = (await sha256Hex(e.payload)) === e.payloadSha256;
    const hashOk = (await sha256Hex(entryHashInput(e))) === e.hash;
    if (!payloadOk || !hashOk) {
      bad++;
      fail('Record matches its chain entry', `Entry ${e.seq} (${e.entryType}) does not match its own hash.`);
    }
  }
  if (!bad) checks.push({ status: 'pass', title: 'Records match their chain entries', detail: `${packEntries.length} chain entries checked.` });

  // 2. The entries belong to the published chain, which links up unbroken to its anchors
  if (packEntries.length) {
    const from = Math.min(...packEntries.map((e) => e.seq));
    let published: ChainEntry[];
    try {
      published = await chain.entries(from);
    } catch {
      fail('Published chain', 'Could not download the published chain. Check your connection and try again.');
      return done(manifest);
    }
    const bySeq = new Map(published.map((e) => [e.seq, e]));
    let linkOk = published.length > 0 && published[0].seq === from;
    for (let i = 0; i < published.length && linkOk; i++) {
      const e = published[i];
      if ((await sha256Hex(entryHashInput(e))) !== e.hash) linkOk = false;
      if (i > 0 && (e.seq !== published[i - 1].seq + 1 || e.prevHash !== published[i - 1].hash)) linkOk = false;
    }
    const missing = packEntries.filter((e) => bySeq.get(e.seq)?.hash !== e.hash || bySeq.get(e.seq)?.payloadSha256 !== e.payloadSha256);
    if (!linkOk) fail('Published chain is unbroken', 'The published chain does not link up: an entry was changed or removed.');
    else if (missing.length) fail('Entries are in the published chain', `${missing.length} entries in the pack differ from the published chain (first: ${missing[0].seq}).`);
    else checks.push({ status: 'pass', title: 'Entries are in the published chain', detail: `Linked from entry ${from} to the latest entry ${published.at(-1)!.seq}.` });

    // Latest version of each record: nothing newer may be left out of the pack
    const latest = new Map<string, ChainEntry>();
    for (const e of published) latest.set(`${e.entryType}:${e.refId}`, e);
    const packLatest = new Map<string, PackEntry>();
    for (const e of packEntries) {
      const k = `${e.entryType}:${e.refId}`;
      if (!packLatest.has(k) || packLatest.get(k)!.seq < e.seq) packLatest.set(k, e);
    }
    let stale = 0;
    for (const [k, e] of packLatest) if (latest.get(k)?.seq !== e.seq) stale++;
    if (stale) checks.push({ status: 'warn', title: 'Pack is out of date', detail: `${stale} records have changed since this pack was made. Download a new pack for the current state.` });

    // Anchors: the chain at each published anchor must hash to the published value
    if (linkOk) {
      try {
        const anchors = (await chain.anchors()).filter((a) => a.seq >= from);
        const wrong = anchors.filter((a) => bySeq.get(a.seq) && bySeq.get(a.seq)!.hash !== a.hash);
        const last = anchors.find((a) => bySeq.has(a.seq));
        const maxPack = Math.max(...packEntries.map((e) => e.seq));
        if (wrong.length) fail('Matches published anchors', `The chain differs from the hash published at entry ${wrong[0].seq}.`);
        else if (!last || last.seq < maxPack)
          checks.push({ status: 'warn', title: 'Not yet anchored', detail: 'Some entries are newer than the last published anchor. Anchors are published every few minutes; check again later.' });
        else checks.push({ status: 'pass', title: 'Matches published anchors', detail: `Covered by the anchor published at ${last.createdAt} (entry ${last.seq}, hash ${last.hash.slice(0, 16)}…).` });
      } catch {
        checks.push({ status: 'warn', title: 'Published anchors', detail: 'Could not download the published anchors.' });
      }
    }
  }

  // 3. Records as stored now equal their latest chained version
  const byRef = new Map<string, PackEntry>();
  for (const e of packEntries) {
    const k = `${e.entryType}:${e.refId}`;
    if (!byRef.has(k) || byRef.get(k)!.seq < e.seq) byRef.set(k, e);
  }
  let changed = 0;
  for (const r of manifest.records) {
    const e = byRef.get(`${r.entryType}:${r.refId}`);
    if (!e || (await sha256Hex(canonicalJson(r.current))) !== e.payloadSha256) {
      changed++;
      fail('Stored record unchanged', `The stored ${r.entryType.replace('_', ' ')} ${r.refId} differs from its chained version.`);
    }
  }
  if (!changed) checks.push({ status: 'pass', title: 'Stored records unchanged', detail: `${manifest.records.length} records equal their latest chained version.` });

  // 4. Photographs match the hashes recorded when they arrived
  let photoBad = 0;
  for (const [sha, name] of Object.entries(manifest.photos)) {
    const bytes = files.get(name);
    if (!bytes || (await sha256Hex(bytes)) !== sha) {
      photoBad++;
      fail('Photograph unchanged', `${name} does not match the hash recorded when it arrived.`);
    }
  }
  const recorded = new Set(
    manifest.records
      .filter((r) => r.entryType === 'submission' && (r.current as { status?: string }).status === 'verified')
      .map((r) => (r.current as { imageSha256?: string | null }).imageSha256)
      .filter((sha): sha is string => !!sha),
  );
  const unlisted = Object.keys(manifest.photos).filter((sha) => !recorded.has(sha));
  if (unlisted.length) fail('Photographs belong to chained records', `${unlisted.length} photographs are not referenced by any chained record.`);
  // Every accepted photograph must be present: a removed photo is a change too
  const absent = [...recorded].filter((sha) => !manifest.photos[sha]);
  if (absent.length) fail('Accepted photographs present', `${absent.length} accepted photographs are missing from storage.`);
  if (!photoBad && !unlisted.length && !absent.length)
    checks.push({ status: 'pass', title: 'Photographs unchanged', detail: `${Object.keys(manifest.photos).length} ${Object.keys(manifest.photos).length === 1 ? 'photograph matches its' : 'photographs match their'} recorded SHA-256.` });

  return done(manifest);
}
