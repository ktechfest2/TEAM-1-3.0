import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { PACK_FORMAT, type PackEntry, type PackManifest, type PackRecord } from '@trustelect/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { declarations, elections, pollingUnits, submissions, unitResults, wards } from '../database/schema.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { TallyService } from '../tally/tally.service.js';
import { ChainService } from './chain.service.js';
import { declarationRecord, submissionRecord, unitResultRecord } from './records.js';
import { writeZip } from './zip.js';

/** Packs larger than this are refused; download the polling units one by one instead */
const MAX_PHOTO_BYTES = 200 * 1024 * 1024;

const README = `TrustElect evidence pack
========================

Citizen-collated, unofficial. Official results are declared by INEC.

manifest.json  The election and area, every record as it is stored now (accepted photo
               submissions, polling unit results with their versions and anonymised witness
               counts, approved declarations) and the comparison status at the time.
chain.json     The hash chain entries for these records: each holds the record exactly as
               chained, its SHA-256, the hash of the entry before it and its own hash.
photos/        The accepted photographs, named by their SHA-256.

To check this pack, open the TrustElect "Verify evidence" page and select this file.
The check confirms that every record matches its chain entry, that the entries are part of
the published chain and its published anchors, that the stored records have not changed
since they were chained, and that every photograph matches the hash recorded on arrival.

The pack contains no phone numbers, device or network identifiers or locations of voters.
`;

/** Downloadable evidence per polling unit or ward (EVD-04). */
@Injectable()
export class EvidencePackService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly chain: ChainService,
    private readonly storage: EvidenceStorage,
    private readonly tally: TallyService,
  ) {}

  async build(electionId: string, level: 'polling_unit' | 'ward', code: string) {
    const [election] = await this.db
      .select({ id: elections.id, title: elections.title })
      .from(elections)
      .where(and(eq(elections.id, electionId), ne(elections.status, 'draft')))
      .limit(1);
    if (!election) throw new NotFoundException('Election not found');

    const units = await this.db
      .select({ id: pollingUnits.id, code: pollingUnits.code, name: pollingUnits.name, wardCode: wards.code, wardName: wards.name })
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .where(level === 'ward' ? eq(wards.code, code) : eq(pollingUnits.code, code));
    if (!units.length) throw new NotFoundException(level === 'ward' ? 'Ward not found' : 'Polling unit not found');
    const wardCode = units[0].wardCode;
    const unitIds = units.map((u) => u.id);

    const records: PackRecord[] = [];
    const refs = { submission: [] as string[], unit_result: [] as string[], declaration: [] as string[] };

    const results = await this.db
      .select({ pollingUnitId: unitResults.pollingUnitId })
      .from(unitResults)
      .where(and(eq(unitResults.electionId, electionId), inArray(unitResults.pollingUnitId, unitIds)));
    for (const r of results) {
      const u = await unitResultRecord(this.db, electionId, r.pollingUnitId);
      if (!u) continue;
      records.push({ entryType: 'unit_result', refId: u.ref, current: u.record });
      refs.unit_result.push(u.ref);
    }

    const accepted = await this.db
      .select({ id: submissions.id, imageKey: submissions.imageKey })
      .from(submissions)
      .where(and(eq(submissions.electionId, electionId), inArray(submissions.pollingUnitId, unitIds), eq(submissions.status, 'verified')));
    const photos: Record<string, string> = {};
    const files: { name: string; data: Buffer }[] = [];
    let photoBytes = 0;
    for (const s of accepted) {
      const record = await submissionRecord(this.db, s.id);
      if (!record) continue;
      records.push({ entryType: 'submission', refId: s.id, current: record });
      refs.submission.push(s.id);
      if (s.imageKey && record.imageSha256 && !photos[record.imageSha256]) {
        const name = `photos/${record.imageSha256}.${s.imageKey.endsWith('.webp') ? 'webp' : 'jpg'}`;
        // A missing file is reported by the check, not hidden
        const data = await this.storage.get(s.imageKey).catch(() => null);
        if (!data) continue;
        photoBytes += data.length;
        if (photoBytes > MAX_PHOTO_BYTES) {
          throw new HttpException('This area has too many photographs for one pack. Download the polling units one by one.', HttpStatus.PAYLOAD_TOO_LARGE);
        }
        photos[record.imageSha256] = name;
        files.push({ name, data });
      }
    }

    const declared = await this.db
      .select({ id: declarations.id })
      .from(declarations)
      .where(and(eq(declarations.electionId, electionId), eq(declarations.level, 'ward'), eq(declarations.areaCode, wardCode), eq(declarations.status, 'approved')));
    for (const d of declared) {
      const record = await declarationRecord(this.db, d.id);
      if (!record) continue;
      records.push({ entryType: 'declaration', refId: d.id, current: record });
      refs.declaration.push(d.id);
    }

    const entries: PackEntry[] = [
      ...(await this.chain.history('unit_result', refs.unit_result)),
      ...(await this.chain.history('submission', refs.submission)),
      ...(await this.chain.history('declaration', refs.declaration)),
    ]
      .map(({ seq, entryType, refId, payload, payloadSha256, prevHash, hash, createdAt }) => ({
        seq,
        entryType: entryType as PackEntry['entryType'],
        refId,
        payload,
        payloadSha256,
        prevHash,
        hash,
        createdAt,
      }))
      .sort((a, b) => a.seq - b.seq);

    const comparison = await this.tally
      .area(electionId, 'ward', wardCode)
      .then((t) => t.totals.comparison ?? null)
      .catch(() => null);
    const head = await this.chain.head();
    const area =
      level === 'ward'
        ? { level, code: wardCode, name: units[0].wardName }
        : { level, code: units[0].code, name: units[0].name };
    const manifest: PackManifest = {
      format: PACK_FORMAT,
      generatedAt: new Date().toISOString(),
      election: { id: election.id, title: election.title },
      area,
      chainHead: head && { seq: head.seq, hash: head.hash },
      records,
      photos,
      comparison,
    };

    const zip = writeZip([
      { name: 'README.txt', data: Buffer.from(README) },
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
      { name: 'chain.json', data: Buffer.from(JSON.stringify(entries, null, 2)) },
      ...files,
    ]);
    return { zip, filename: `trustelect-evidence-${area.code}.zip` };
  }
}
