import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { Database } from '../database/database.module.js';
import { electionParties, elections, lgas, parties, states } from '../database/schema.js';

export const ELECTION_TYPES = [
  'presidential',
  'governorship',
  'senate',
  'house_of_representatives',
  'state_assembly',
  'area_council',
  'local_government',
] as const;

export const createPartySchema = z.object({
  acronym: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9-]{1,9}$/, 'Acronym: 2 to 10 letters or digits'),
  name: z.string().trim().min(3).max(120),
});

export const createElectionSchema = z
  .object({
    type: z.enum(ELECTION_TYPES),
    title: z.string().trim().min(5).max(160),
    electionDate: z.iso.date(),
    scopeLevel: z.enum(['national', 'state', 'lga']),
    scopeCode: z.string().trim().max(12).optional(),
    /** ISO date-time with offset, for example 2027-02-20T14:30:00+01:00 */
    pollsCloseAt: z.iso.datetime({ offset: true }),
    /** Party acronyms in ballot order */
    partyAcronyms: z.array(z.string().trim().toUpperCase()).min(2).max(40),
  })
  .refine((v) => (v.scopeLevel === 'national') === !v.scopeCode, {
    message: 'A state or LGA election needs an area code; a national election must not have one',
    path: ['scopeCode'],
  })
  .refine((v) => new Set(v.partyAcronyms).size === v.partyAcronyms.length, {
    message: 'A party appears more than once',
    path: ['partyAcronyms'],
  });

export type CreateParty = z.infer<typeof createPartySchema>;
export type CreateElection = z.infer<typeof createElectionSchema>;
export type ElectionStatus = (typeof elections.$inferSelect)['status'];

/** Allowed status changes. Elections never go back to draft or reopen once closed. */
const NEXT_STATUS: Record<ElectionStatus, ElectionStatus[]> = {
  draft: ['active'],
  active: ['closed'],
  closed: [],
};

@Injectable()
export class ElectionsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /* ---------------- Parties ---------------- */

  listParties() {
    return this.db
      .select({ id: parties.id, acronym: parties.acronym, name: parties.name })
      .from(parties)
      .orderBy(asc(parties.acronym));
  }

  async createParty(input: CreateParty, adminId: string) {
    const [existing] = await this.db.select().from(parties).where(eq(parties.acronym, input.acronym)).limit(1);
    if (existing) throw new ConflictException(`${input.acronym} already exists`);
    const [party] = await this.db.insert(parties).values(input).returning();
    await this.audit.record({ adminUserId: adminId, action: 'party.created', targetType: 'party', targetId: String(party.id), details: input });
    return party;
  }

  /* ---------------- Elections ---------------- */

  async listElections(options: { includeDrafts: boolean }) {
    const rows = await this.db
      .select({
        id: elections.id,
        type: elections.type,
        title: elections.title,
        electionDate: elections.electionDate,
        scopeLevel: elections.scopeLevel,
        scopeCode: elections.scopeCode,
        pollsCloseAt: elections.pollsCloseAt,
        status: elections.status,
        parties: count(electionParties.partyId),
      })
      .from(elections)
      .leftJoin(electionParties, eq(electionParties.electionId, elections.id))
      .where(options.includeDrafts ? undefined : ne(elections.status, 'draft'))
      .groupBy(elections.id)
      .orderBy(desc(elections.electionDate), asc(elections.title));
    return rows;
  }

  async getElection(id: string, options: { includeDrafts: boolean }) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [election] = await this.db.select().from(elections).where(eq(elections.id, id)).limit(1);
    if (!election || (!options.includeDrafts && election.status === 'draft')) throw new NotFoundException();
    const ballot = await this.db
      .select({ acronym: parties.acronym, name: parties.name, ballotOrder: electionParties.ballotOrder })
      .from(electionParties)
      .innerJoin(parties, eq(parties.id, electionParties.partyId))
      .where(eq(electionParties.electionId, id))
      .orderBy(asc(electionParties.ballotOrder));
    return { ...election, parties: ballot };
  }

  async createElection(input: CreateElection, adminId: string) {
    await this.assertScopeExists(input.scopeLevel, input.scopeCode);

    const close = new Date(input.pollsCloseAt);
    const sameDay = close.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) === input.electionDate;
    if (!sameDay) throw new BadRequestException('Polls must close on the election date (Nigerian time)');

    const found = await this.db
      .select({ id: parties.id, acronym: parties.acronym })
      .from(parties)
      .where(inArray(parties.acronym, input.partyAcronyms));
    const missing = input.partyAcronyms.filter((a) => !found.some((p) => p.acronym === a));
    if (missing.length) throw new BadRequestException(`Unknown parties: ${missing.join(', ')}`);
    const idByAcronym = new Map(found.map((p) => [p.acronym, p.id]));

    const election = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(elections)
        .values({
          type: input.type,
          title: input.title,
          electionDate: input.electionDate,
          scopeLevel: input.scopeLevel,
          scopeCode: input.scopeCode ?? null,
          pollsCloseAt: close,
        })
        .returning();
      await tx.insert(electionParties).values(
        input.partyAcronyms.map((acronym, i) => ({
          electionId: created.id,
          partyId: idByAcronym.get(acronym)!,
          ballotOrder: i + 1,
        })),
      );
      return created;
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'election.created',
      targetType: 'election',
      targetId: election.id,
      details: { ...input },
    });
    return this.getElection(election.id, { includeDrafts: true });
  }

  async setStatus(id: string, status: ElectionStatus, adminId: string) {
    const election = await this.getElection(id, { includeDrafts: true });
    if (!NEXT_STATUS[election.status].includes(status)) {
      throw new BadRequestException(`An election cannot move from ${election.status} to ${status}`);
    }
    await this.db.update(elections).set({ status }).where(eq(elections.id, id));
    await this.audit.record({
      adminUserId: adminId,
      action: 'election.status_changed',
      targetType: 'election',
      targetId: id,
      details: { from: election.status, to: status },
    });
    return this.getElection(id, { includeDrafts: true });
  }

  private async assertScopeExists(level: CreateElection['scopeLevel'], code?: string) {
    if (level === 'national') return;
    const table = level === 'state' ? states : lgas;
    const [row] = await this.db.select({ id: table.id }).from(table).where(eq(table.code, code!)).limit(1);
    if (!row) throw new BadRequestException(`No ${level === 'state' ? 'state' : 'LGA'} with code ${code} in the register`);
  }
}
