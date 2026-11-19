import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { compare, type Comparison } from '../declarations/compare.js';
import { DeclarationsService } from '../declarations/declarations.service.js';
import { electionParties, elections, lgas, parties, states, wards } from '../database/schema.js';

/**
 * Counting engine (Specification 6.4, CNT-01 to CNT-08): adds up the counted result of
 * every polling unit to ward, LGA, state and national level, with coverage and the
 * confidence mix. Never names a leader or projects uncovered units.
 */

export type TallyLevel = 'national' | 'state' | 'lga' | 'ward';
const ORDER: TallyLevel[] = ['national', 'state', 'lga', 'ward'];
const CHILD: Record<TallyLevel, 'state' | 'lga' | 'ward' | 'polling_unit'> = {
  national: 'state',
  state: 'lga',
  lga: 'ward',
  ward: 'polling_unit',
};

export interface Mix {
  high: number;
  medium: number;
  low: number;
  provisional: number;
  disputed: number;
  notConfirmed: number;
}

export interface AreaTally {
  code: string | null;
  name: string;
  totalUnits: number;
  /** Units whose result is in the totals: counted, provisional or resolved */
  countedUnits: number;
  mix: Mix;
  partyVotes: Record<string, number>;
  totalValid: number;
  /** Sum of rejected votes over units whose poster shows them */
  rejected: number;
  rejectedReportedUnits: number;
  /** Only for polling units: their status */
  status?: string;
  /** Totals without low-confidence units, to judge how strong a difference is */
  strong: { partyVotes: Record<string, number>; totalValid: number };
  /** Comparison with an approved declaration for this area (ward, LGA, state, national) */
  comparison?: Comparison;
}

interface Row {
  code: string;
  name: string;
  total_units: string;
  counted_units: string;
  high: string;
  medium: string;
  low: string;
  provisional: string;
  disputed: string;
  total_valid: string | null;
  rejected: string | null;
  rejected_units: string;
  total_valid_strong: string | null;
  status: string | null;
}

const CACHE_MS = 5_000;

@Injectable()
export class TallyService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly declarations: DeclarationsService,
  ) {}

  /** Forget cached tallies of an election (called when one of its units changes). */
  invalidate(electionId: string) {
    for (const key of this.cache.keys()) if (key.startsWith(`${electionId}|`)) this.cache.delete(key);
  }

  async area(electionId: string, level?: string, code?: string) {
    const key = `${electionId}|${level ?? ''}|${code ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Awaited<ReturnType<TallyService['compute']>>;
    const value = await this.compute(electionId, level, code);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async compute(electionId: string, rawLevel?: string, rawCode?: string) {
    const [election] = await this.db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
    if (!election || election.status === 'draft') throw new NotFoundException('Election not found');

    // The election's own area is the top; requests can only go down from it
    const scopeLevel = (election.scopeLevel === 'polling_unit' ? 'ward' : election.scopeLevel) as TallyLevel;
    const level = (rawLevel ?? scopeLevel) as TallyLevel;
    if (!ORDER.includes(level) || ORDER.indexOf(level) < ORDER.indexOf(scopeLevel)) {
      throw new BadRequestException('That level is above this election’s area');
    }
    const code = level === 'national' ? null : (rawCode ?? (level === scopeLevel ? election.scopeCode : null));
    if (level !== 'national' && !code) throw new BadRequestException('An area code is needed');
    if (level !== 'national' && !/^\d{2}(-\d{2}){0,2}$/.test(code!)) throw new BadRequestException('Invalid area code');
    if (election.scopeLevel !== 'national' && election.scopeCode && !code!.startsWith(election.scopeCode)) {
      throw new BadRequestException('That area is outside this election');
    }

    const ballot = await this.db
      .select({ acronym: parties.acronym, name: parties.name })
      .from(electionParties)
      .innerJoin(parties, eq(parties.id, electionParties.partyId))
      .where(eq(electionParties.electionId, electionId))
      .orderBy(asc(electionParties.ballotOrder));

    const childLevel = CHILD[level];
    const [childCode, childName] = {
      state: [sql`s.code`, sql`s.name`],
      lga: [sql`l.code`, sql`l.name`],
      ward: [sql`w.code`, sql`w.name`],
      polling_unit: [sql`pu.code`, sql`pu.name`],
    }[childLevel];
    const filter: SQL = {
      national: sql`true`,
      state: sql`s.code = ${code}`,
      lga: sql`l.code = ${code}`,
      ward: sql`w.code = ${code}`,
    }[level];

    const area = sql`
      select pu.id, ${childCode} as code, ${childName} as name,
             ur.status, ur.confidence, rv.figures
      from polling_units pu
      join wards w on w.id = pu.ward_id
      join lgas l on l.id = w.lga_id
      join states s on s.id = l.state_id
      left join unit_results ur on ur.polling_unit_id = pu.id and ur.election_id = ${electionId}
      left join result_versions rv on rv.id = ur.counted_version_id
      where ${filter}`;

    const counted = sql`status in ('counted', 'provisional', 'resolved') and figures is not null`;
    const rows = (
      await this.db.execute<Row>(sql`
        with area as (${area})
        select code, name,
          count(*) as total_units,
          count(*) filter (where ${counted}) as counted_units,
          count(*) filter (where ${counted} and status <> 'provisional' and confidence = 'high') as high,
          count(*) filter (where ${counted} and status <> 'provisional' and confidence = 'medium') as medium,
          count(*) filter (where ${counted} and status <> 'provisional' and confidence = 'low') as low,
          count(*) filter (where status = 'provisional') as provisional,
          count(*) filter (where status = 'disputed') as disputed,
          sum((figures->>'totalValid')::int) filter (where ${counted}) as total_valid,
          sum((figures->>'rejected')::int) filter (where ${counted} and figures->>'rejected' is not null) as rejected,
          count(*) filter (where ${counted} and figures->>'rejected' is not null) as rejected_units,
          sum((figures->>'totalValid')::int) filter (where ${counted} and confidence <> 'low') as total_valid_strong,
          max(status::text) as status
        from area
        group by code, name
        order by code`)
    ).rows;

    const partyRows = (
      await this.db.execute<{ code: string; party: string; votes: string }>(sql`
        with area as (${area})
        select code, kv.key as party, sum(kv.value::int) as votes
        from area, jsonb_each_text(figures->'partyVotes') as kv
        where ${counted}
        group by code, kv.key`)
    ).rows;

    const strongRows = (
      await this.db.execute<{ code: string; party: string; votes: string }>(sql`
        with area as (${area})
        select code, kv.key as party, sum(kv.value::int) as votes
        from area, jsonb_each_text(figures->'partyVotes') as kv
        where ${counted} and confidence <> 'low'
        group by code, kv.key`)
    ).rows;

    const group = (list: { code: string; party: string; votes: string }[]) => {
      const out = new Map<string, Record<string, number>>();
      for (const r of list) {
        const v = out.get(r.code) ?? {};
        v[r.party] = Number(r.votes);
        out.set(r.code, v);
      }
      return out;
    };
    const votesByChild = group(partyRows);
    const strongByChild = group(strongRows);

    const children: AreaTally[] = rows.map((r) => {
      const t: AreaTally = {
        code: r.code,
        name: r.name,
        totalUnits: Number(r.total_units),
        countedUnits: Number(r.counted_units),
        mix: {
          high: Number(r.high),
          medium: Number(r.medium),
          low: Number(r.low),
          provisional: Number(r.provisional),
          disputed: Number(r.disputed),
          notConfirmed: Number(r.total_units) - Number(r.counted_units) - Number(r.disputed),
        },
        partyVotes: votesByChild.get(r.code) ?? {},
        totalValid: Number(r.total_valid ?? 0),
        rejected: Number(r.rejected ?? 0),
        rejectedReportedUnits: Number(r.rejected_units),
        strong: { partyVotes: strongByChild.get(r.code) ?? {}, totalValid: Number(r.total_valid_strong ?? 0) },
      };
      if (childLevel === 'polling_unit') t.status = r.status ?? 'not_confirmed';
      return t;
    });

    const total = sumTallies(children);
    const names = await this.areaNames(level, code);
    const acronyms = ballot.map((b) => b.acronym);

    // Comparison with approved declarations: for this area, and for each child area
    const [own] = await this.comparisons(electionId, level, [{ code, tally: total }], acronyms);
    if (childLevel !== 'polling_unit') {
      const childComparisons = await this.comparisons(
        electionId,
        childLevel,
        children.map((c) => ({ code: c.code, tally: c })),
        acronyms,
      );
      children.forEach((c, i) => (c.comparison = childComparisons[i]));
    }

    return {
      election: { id: election.id, title: election.title, type: election.type, electionDate: election.electionDate, status: election.status },
      parties: ballot,
      area: { level, code, name: names.at(-1)?.name ?? 'Nigeria', path: names },
      childLevel,
      totals: { ...total, code, name: names.at(-1)?.name ?? 'Nigeria', comparison: own },
      children,
      generatedAt: new Date().toISOString(),
    };
  }

  private async comparisons(
    electionId: string,
    level: TallyLevel,
    areas: { code: string | null; tally: Omit<AreaTally, 'code' | 'name'> }[],
    ballot: string[],
  ): Promise<Comparison[]> {
    const approved = await this.declarations.approvedFor(electionId, level, areas.map((a) => a.code));
    return Promise.all(
      areas.map(async ({ code, tally }) => {
        const mine = approved.filter((d) => d.areaCode === code);
        const unitDifferences = await this.unitDifferences(electionId, mine.flatMap((d) => (d.unitFigures ? [d.unitFigures] : [])));
        return compare({
          ballot,
          declarations: mine.map((d) => ({ partyVotes: d.figures.partyVotes, totalValid: d.figures.totalValid })),
          citizen: {
            partyVotes: tally.partyVotes,
            totalValid: tally.totalValid,
            countedUnits: tally.countedUnits,
            totalUnits: tally.totalUnits,
            provisionalUnits: tally.mix.provisional,
            disputedUnits: tally.mix.disputed,
          },
          citizenExcludingLow: tally.strong,
          unitDifferences,
        });
      }),
    );
  }

  /** Units listed in a declaration whose figures differ from their counted citizen result (CMP-08). */
  private async unitDifferences(electionId: string, listed: Record<string, { partyVotes: Record<string, number> }>[]) {
    const codes = [...new Set(listed.flatMap((l) => Object.keys(l)))];
    if (!codes.length) return [];
    const counted = (
      await this.db.execute<{ code: string; confidence: string | null; figures: { partyVotes: Record<string, number> } }>(sql`
        select pu.code, ur.confidence, rv.figures
        from polling_units pu
        join unit_results ur on ur.polling_unit_id = pu.id and ur.election_id = ${electionId}
        join result_versions rv on rv.id = ur.counted_version_id
        where pu.code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
          and ur.status in ('counted', 'provisional', 'resolved')`)
    ).rows;
    const diffs: { unitCode: string; lowConfidence: boolean }[] = [];
    for (const row of counted) {
      const declared = listed.find((l) => l[row.code])?.[row.code];
      if (!declared) continue;
      const keys = new Set([...Object.keys(declared.partyVotes), ...Object.keys(row.figures.partyVotes)]);
      if ([...keys].some((k) => (declared.partyVotes[k] ?? 0) !== (row.figures.partyVotes[k] ?? 0))) {
        diffs.push({ unitCode: row.code, lowConfidence: row.confidence === 'low' });
      }
    }
    return diffs;
  }

  /** Breadcrumb from the national level down to the requested area. */
  private async areaNames(level: TallyLevel, code: string | null) {
    const path: { level: TallyLevel; code: string | null; name: string }[] = [{ level: 'national', code: null, name: 'Nigeria' }];
    if (!code || level === 'national') return path;
    const [state] = await this.db.select().from(states).where(eq(states.code, code.slice(0, 2))).limit(1);
    if (state) path.push({ level: 'state', code: state.code, name: state.name });
    if (code.length >= 5) {
      const [lga] = await this.db.select().from(lgas).where(eq(lgas.code, code.slice(0, 5))).limit(1);
      if (lga) path.push({ level: 'lga', code: lga.code, name: lga.name });
    }
    if (code.length >= 8) {
      const [ward] = await this.db.select().from(wards).where(eq(wards.code, code.slice(0, 8))).limit(1);
      if (ward) path.push({ level: 'ward', code: ward.code, name: ward.name });
    }
    if (path.length - 1 !== ORDER.indexOf(level)) throw new NotFoundException('Area not found');
    return path;
  }
}

export function sumTallies(children: AreaTally[]): Omit<AreaTally, 'code' | 'name' | 'comparison'> {
  const out = {
    totalUnits: 0,
    countedUnits: 0,
    mix: { high: 0, medium: 0, low: 0, provisional: 0, disputed: 0, notConfirmed: 0 } as Mix,
    partyVotes: {} as Record<string, number>,
    totalValid: 0,
    rejected: 0,
    rejectedReportedUnits: 0,
    strong: { partyVotes: {} as Record<string, number>, totalValid: 0 },
  };
  for (const c of children) {
    out.totalUnits += c.totalUnits;
    out.countedUnits += c.countedUnits;
    for (const k of Object.keys(out.mix) as (keyof Mix)[]) out.mix[k] += c.mix[k];
    for (const [p, v] of Object.entries(c.partyVotes)) out.partyVotes[p] = (out.partyVotes[p] ?? 0) + v;
    out.totalValid += c.totalValid;
    out.rejected += c.rejected;
    out.rejectedReportedUnits += c.rejectedReportedUnits;
    for (const [p, v] of Object.entries(c.strong.partyVotes)) out.strong.partyVotes[p] = (out.strong.partyVotes[p] ?? 0) + v;
    out.strong.totalValid += c.strong.totalValid;
  }
  return out;
}
