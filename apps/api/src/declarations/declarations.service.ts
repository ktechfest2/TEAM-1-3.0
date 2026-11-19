import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { parseUnitCode } from '@trustelect/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { imageType } from '../capture/capture.service.js';
import type { Database } from '../database/database.module.js';
import { adminUsers, declarations, electionParties, elections, lgas, parties, states, wards } from '../database/schema.js';
import { sha256 } from '../security/encryption.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { RESULTS_CHANNEL } from '../tally/results-stream.service.js';
import { normaliseParty } from '../verification/decide.js';
import { VisionModel } from '../verification/vision-model.js';

const LEVELS = ['national', 'state', 'lga', 'ward'] as const;
type Level = (typeof LEVELS)[number];
const RANK: Record<string, number> = { national: 0, state: 1, lga: 2, ward: 3, polling_unit: 4 };

const figure = z.number().int().min(0).max(100_000_000);

export const createDeclarationSchema = z
  .object({
    electionId: z.uuid(),
    level: z.enum(LEVELS),
    areaCode: z.string().trim().max(12).nullable().optional(),
    partyVotes: z.record(z.string(), figure),
    totalValid: figure.nullable().optional(),
    rejected: figure.nullable().optional(),
    totalCast: figure.nullable().optional(),
    /** Per-polling-unit figures listed in the declaration, when it shows them (CMP-08) */
    unitFigures: z.record(z.string(), z.record(z.string(), figure)).optional(),
    declaredAt: z.iso.datetime({ offset: true }),
    sourceKind: z.enum(['collation_result_photo', 'inec_statement', 'broadcast']),
    sourceUrl: z.url({ protocol: /^https$/ }).optional(),
    sourceFileKey: z.string().regex(/^[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|webp)$/).optional(),
    /** Must be true to record figures whose party scores do not add up to the total */
    acknowledgeArithmetic: z.boolean().optional(),
  })
  .refine((d) => d.sourceUrl || d.sourceFileKey, { message: 'Attach a photo of the source or give an https link to it', path: ['sourceUrl'] })
  .refine((d) => (d.level === 'national') === !d.areaCode, {
    message: 'A ward, LGA or state declaration needs its area code; a national one must not have one',
    path: ['areaCode'],
  });

export type CreateDeclaration = z.infer<typeof createDeclarationSchema>;

@Injectable()
export class DeclarationsService {
  private readonly logger = new Logger('Declarations');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly storage: EvidenceStorage,
    private readonly model: VisionModel,
  ) {}

  private async ballot(electionId: string) {
    return (
      await this.db
        .select({ acronym: parties.acronym })
        .from(electionParties)
        .innerJoin(parties, eq(parties.id, electionParties.partyId))
        .where(eq(electionParties.electionId, electionId))
        .orderBy(asc(electionParties.ballotOrder))
    ).map((p) => p.acronym);
  }

  private async electionOrThrow(id: string) {
    const [election] = await this.db.select().from(elections).where(eq(elections.id, id)).limit(1);
    if (!election || election.status === 'draft') throw new NotFoundException('Election not found or still a draft');
    return election;
  }

  /** Name of a ward, LGA or state, or null if the code is not in the register. */
  private async areaName(level: Level, code: string | null): Promise<string | null> {
    if (level === 'national') return 'Nigeria';
    const table = { state: states, lga: lgas, ward: wards }[level];
    const [row] = await this.db.select({ name: table.name }).from(table).where(eq(table.code, code!)).limit(1);
    return row?.name ?? null;
  }

  /**
   * Stores a photo of the source document and, when possible, reads it with AI to prefill
   * the figures. The administrator still checks and enters every number (CMP-02).
   */
  async uploadSource(electionId: string, bytes: Buffer, adminId: string) {
    const election = await this.electionOrThrow(electionId);
    const type = imageType(bytes);
    if (!type) throw new BadRequestException('The source must be a JPEG or WebP image');
    if (bytes.length > 10 * 1024 * 1024) throw new BadRequestException('The image is too large');
    const digest = sha256(bytes);
    const key = await this.storage.put(digest, bytes, type === 'image/webp' ? 'webp' : 'jpg');
    await this.audit.record({ adminUserId: adminId, action: 'declaration.source_uploaded', targetType: 'election', targetId: electionId, details: { sha256: digest } });

    const ballot = await this.ballot(electionId);
    let reading = null;
    let prefill = null;
    try {
      reading = await this.model.readDeclaration(bytes, type, `Election: ${election.title}. Parties on this ballot: ${ballot.join(', ')}.`);
      const byKey = new Map(ballot.map((a) => [normaliseParty(a), a]));
      const partyVotes: Record<string, number | null> = Object.fromEntries(ballot.map((a) => [a, null]));
      const unmatched: string[] = [];
      for (const r of reading.party_results) {
        const acronym = byKey.get(normaliseParty(r.party));
        if (acronym) partyVotes[acronym] = r.legible ? r.votes : null;
        else unmatched.push(r.party);
      }
      prefill = {
        partyVotes,
        totalValid: reading.total_valid_votes,
        rejected: reading.rejected_votes,
        totalCast: reading.total_votes_cast,
        unmatchedParties: unmatched,
      };
    } catch (err) {
      this.logger.warn(`AI could not read the source: ${(err as Error).message}`);
    }
    return { sourceFileKey: key, sourceSha256: digest, reading, prefill };
  }

  async create(input: CreateDeclaration, adminId: string) {
    const election = await this.electionOrThrow(input.electionId);
    const code = input.level === 'national' ? null : input.areaCode!;

    // The area must be at or below the election's area, and inside it
    if (RANK[input.level] < RANK[election.scopeLevel]) {
      throw new BadRequestException("A declaration cannot be for a larger area than the election's");
    }
    if (election.scopeLevel !== 'national' && !code?.startsWith(election.scopeCode ?? '')) {
      throw new BadRequestException("That area is outside this election's area");
    }
    const name = await this.areaName(input.level, code);
    if (!name) throw new BadRequestException(`No ${input.level.toUpperCase()} with code ${code} in the register`);

    // Every party on the ballot, and nothing else
    const ballot = await this.ballot(input.electionId);
    const given = Object.keys(input.partyVotes);
    const missing = ballot.filter((p) => !(p in input.partyVotes));
    const extra = given.filter((p) => !ballot.includes(p));
    if (missing.length || extra.length) {
      throw new BadRequestException(
        [missing.length ? `Missing parties: ${missing.join(', ')}` : '', extra.length ? `Not on this ballot: ${extra.join(', ')}` : '']
          .filter(Boolean)
          .join('. '),
      );
    }

    const sum = ballot.reduce((a, p) => a + input.partyVotes[p], 0);
    const totalValid = input.totalValid ?? null;
    if (totalValid !== null && totalValid !== sum && !input.acknowledgeArithmetic) {
      throw new BadRequestException(
        `Party scores add up to ${sum}, but total valid votes is ${totalValid}. If the declaration really shows this, confirm to record it as declared.`,
      );
    }
    if (new Date(input.declaredAt).getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('The declaration time cannot be in the future');
    }

    // Listed polling unit figures: units must be in the area
    let unitFigures: Record<string, { partyVotes: Record<string, number>; totalValid: number; rejected: null; totalCast: null }> | null = null;
    if (input.unitFigures && Object.keys(input.unitFigures).length) {
      unitFigures = {};
      for (const [raw, votes] of Object.entries(input.unitFigures)) {
        const u = parseUnitCode(raw);
        if (!u || (code && !u.unit.startsWith(code))) throw new BadRequestException(`Polling unit ${raw} is not in this area`);
        unitFigures[u.unit] = { partyVotes: votes, totalValid: Object.values(votes).reduce((a, b) => a + b, 0), rejected: null, totalCast: null };
      }
    }

    const sourceSha256 = input.sourceFileKey ? input.sourceFileKey.split('/')[1].split('.')[0] : null;
    const [row] = await this.db
      .insert(declarations)
      .values({
        electionId: input.electionId,
        level: input.level,
        areaCode: code,
        figures: { partyVotes: input.partyVotes, totalValid: totalValid ?? sum, rejected: input.rejected ?? null, totalCast: input.totalCast ?? null },
        unitFigures,
        declaredAt: new Date(input.declaredAt),
        sourceKind: input.sourceKind,
        sourceUrl: input.sourceUrl ?? null,
        sourceFileKey: input.sourceFileKey ?? null,
        sourceSha256,
        enteredBy: adminId,
      })
      .returning();
    await this.audit.record({
      adminUserId: adminId,
      action: 'declaration.entered',
      targetType: 'declaration',
      targetId: row.id,
      details: { electionId: input.electionId, level: input.level, areaCode: code, figures: row.figures },
    });
    return { ...row, areaName: name };
  }

  /** Second-person approval (CMP-03, ADM-05): the person who entered it cannot approve it. */
  async approve(id: string, adminId: string) {
    const row = await this.pendingOrThrow(id);
    if (row.enteredBy === adminId) throw new ForbiddenException('A second administrator must approve a declaration you entered');
    await this.db.update(declarations).set({ status: 'approved', approvedBy: adminId, approvedAt: new Date() }).where(eq(declarations.id, id));
    await this.audit.record({ adminUserId: adminId, action: 'declaration.approved', targetType: 'declaration', targetId: id });
    // Dashboards show the comparison straight away
    await this.db.execute(sql`select pg_notify(${RESULTS_CHANNEL}, ${row.electionId})`);
    return this.get(id);
  }

  async reject(id: string, adminId: string, reason: string) {
    const row = await this.pendingOrThrow(id);
    if (row.enteredBy === adminId) throw new ForbiddenException('A second administrator must review a declaration you entered');
    await this.db
      .update(declarations)
      .set({ status: 'rejected', approvedBy: adminId, approvedAt: new Date(), rejectionReason: reason })
      .where(eq(declarations.id, id));
    await this.audit.record({ adminUserId: adminId, action: 'declaration.rejected', targetType: 'declaration', targetId: id, details: { reason } });
    return this.get(id);
  }

  private async pendingOrThrow(id: string) {
    const [row] = await this.db.select().from(declarations).where(eq(declarations.id, id)).limit(1);
    if (!row) throw new NotFoundException('Declaration not found');
    if (row.status !== 'pending') throw new ConflictException(`This declaration is already ${row.status}`);
    return row;
  }

  async get(id: string) {
    const [row] = await this.list({ id });
    if (!row) throw new NotFoundException('Declaration not found');
    return row;
  }

  async list(filter: { id?: string; status?: 'pending' | 'approved' | 'rejected'; electionId?: string } = {}) {
    const enteredBy = sql<string>`(select display_name from ${adminUsers} where ${adminUsers.id} = ${declarations.enteredBy})`;
    const approvedBy = sql<string | null>`(select display_name from ${adminUsers} where ${adminUsers.id} = ${declarations.approvedBy})`;
    const rows = await this.db
      .select({
        id: declarations.id,
        electionId: declarations.electionId,
        electionTitle: elections.title,
        level: declarations.level,
        areaCode: declarations.areaCode,
        figures: declarations.figures,
        unitFigures: declarations.unitFigures,
        declaredAt: declarations.declaredAt,
        sourceKind: declarations.sourceKind,
        sourceUrl: declarations.sourceUrl,
        hasSourceImage: sql<boolean>`${declarations.sourceFileKey} is not null`,
        sourceSha256: declarations.sourceSha256,
        status: declarations.status,
        enteredById: declarations.enteredBy,
        enteredBy,
        approvedBy,
        approvedAt: declarations.approvedAt,
        rejectionReason: declarations.rejectionReason,
        createdAt: declarations.createdAt,
      })
      .from(declarations)
      .innerJoin(elections, eq(elections.id, declarations.electionId))
      .where(
        and(
          filter.id ? eq(declarations.id, filter.id) : undefined,
          filter.status ? eq(declarations.status, filter.status) : undefined,
          filter.electionId ? eq(declarations.electionId, filter.electionId) : undefined,
        ),
      )
      .orderBy(sql`case ${declarations.status} when 'pending' then 0 else 1 end`, desc(declarations.createdAt))
      .limit(200);
    return Promise.all(rows.map(async (r) => ({ ...r, areaName: await this.areaName(r.level as Level, r.areaCode) })));
  }

  /** Approved declarations for areas of one level (used by the comparison). */
  async approvedFor(electionId: string, level: Level, codes: (string | null)[]) {
    const nonNull = codes.filter((c): c is string => c !== null);
    return this.db
      .select({ areaCode: declarations.areaCode, figures: declarations.figures, unitFigures: declarations.unitFigures })
      .from(declarations)
      .where(
        and(
          eq(declarations.electionId, electionId),
          eq(declarations.status, 'approved'),
          eq(declarations.level, level),
          level === 'national' ? isNull(declarations.areaCode) : nonNull.length ? inArray(declarations.areaCode, nonNull) : sql`false`,
        ),
      );
  }

  /** Where the source photo of a declaration is stored (admin viewing). */
  async sourceKey(id: string) {
    const [row] = await this.db.select({ key: declarations.sourceFileKey }).from(declarations).where(eq(declarations.id, id)).limit(1);
    if (!row?.key) throw new NotFoundException('No source photo');
    return row.key;
  }
}
