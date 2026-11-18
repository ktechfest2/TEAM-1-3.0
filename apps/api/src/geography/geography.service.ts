import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { NIGERIAN_STATES, parseUnitCode } from '@trustelect/shared';
import { asc, count, eq, sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { lgas, pollingUnits, states, wards } from '../database/schema.js';
import type { RegisterRow } from './register.js';

const BATCH = 1000;

export interface ImportSummary {
  states: number;
  lgas: number;
  wards: number;
  pollingUnits: number;
}

@Injectable()
export class GeographyService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Inserts the 36 states and the FCT with their INEC codes. Safe to run repeatedly. */
  async seedStates(): Promise<void> {
    await this.db
      .insert(states)
      .values(NIGERIAN_STATES.map((s) => ({ code: s.code, name: s.name })))
      .onConflictDoUpdate({ target: states.code, set: { name: sql`excluded.name` } });
  }

  /**
   * Imports register rows: creates or updates LGAs, wards and polling units by code.
   * Idempotent, so a corrected or newer register can be re-imported.
   */
  async importRegister(rows: RegisterRow[]): Promise<ImportSummary> {
    await this.seedStates();

    return this.db.transaction(async (tx) => {
      const stateIds = new Map(
        (await tx.select({ id: states.id, code: states.code }).from(states)).map((s) => [s.code, s.id]),
      );

      const lgaRows = uniqueBy(rows, (r) => r.lgaCode).map((r) => {
        const stateId = stateIds.get(r.stateCode);
        if (!stateId) throw new Error(`Unknown state code ${r.stateCode} for polling unit ${r.unitCode}`);
        return { stateId, code: r.lgaCode, name: r.lgaName };
      });
      const lgaIds = new Map<string, number>();
      for (const chunk of chunks(lgaRows)) {
        const saved = await tx
          .insert(lgas)
          .values(chunk)
          .onConflictDoUpdate({ target: lgas.code, set: { name: sql`excluded.name`, stateId: sql`excluded.state_id` } })
          .returning({ id: lgas.id, code: lgas.code });
        saved.forEach((l) => lgaIds.set(l.code, l.id));
      }

      const wardRows = uniqueBy(rows, (r) => r.wardCode).map((r) => ({
        lgaId: lgaIds.get(r.lgaCode)!,
        code: r.wardCode,
        name: r.wardName,
      }));
      const wardIds = new Map<string, number>();
      for (const chunk of chunks(wardRows)) {
        const saved = await tx
          .insert(wards)
          .values(chunk)
          .onConflictDoUpdate({ target: wards.code, set: { name: sql`excluded.name`, lgaId: sql`excluded.lga_id` } })
          .returning({ id: wards.id, code: wards.code });
        saved.forEach((w) => wardIds.set(w.code, w.id));
      }

      for (const chunk of chunks(rows)) {
        await tx
          .insert(pollingUnits)
          .values(
            chunk.map((r) => ({
              wardId: wardIds.get(r.wardCode)!,
              code: r.unitCode,
              name: r.unitName,
              latitude: r.latitude,
              longitude: r.longitude,
              registeredVoters: r.registeredVoters,
            })),
          )
          .onConflictDoUpdate({
            target: pollingUnits.code,
            set: {
              name: sql`excluded.name`,
              wardId: sql`excluded.ward_id`,
              latitude: sql`excluded.latitude`,
              longitude: sql`excluded.longitude`,
              registeredVoters: sql`excluded.registered_voters`,
            },
          });
      }

      return {
        states: new Set(rows.map((r) => r.stateCode)).size,
        lgas: lgaRows.length,
        wards: wardRows.length,
        pollingUnits: rows.length,
      };
    });
  }

  async counts(): Promise<ImportSummary> {
    const [[s], [l], [w], [p]] = await Promise.all([
      this.db.select({ n: count() }).from(states),
      this.db.select({ n: count() }).from(lgas),
      this.db.select({ n: count() }).from(wards),
      this.db.select({ n: count() }).from(pollingUnits),
    ]);
    return { states: s.n, lgas: l.n, wards: w.n, pollingUnits: p.n };
  }

  listStates() {
    return this.db
      .select({ code: states.code, name: states.name, lgas: count(lgas.id) })
      .from(states)
      .leftJoin(lgas, eq(lgas.stateId, states.id))
      .groupBy(states.id)
      .orderBy(asc(states.code));
  }

  listLgas(stateCode: string) {
    return this.db
      .select({ code: lgas.code, name: lgas.name, wards: count(wards.id) })
      .from(lgas)
      .innerJoin(states, eq(states.id, lgas.stateId))
      .leftJoin(wards, eq(wards.lgaId, lgas.id))
      .where(eq(states.code, stateCode))
      .groupBy(lgas.id)
      .orderBy(asc(lgas.code));
  }

  listWards(lgaCode: string) {
    return this.db
      .select({ code: wards.code, name: wards.name, pollingUnits: count(pollingUnits.id) })
      .from(wards)
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .leftJoin(pollingUnits, eq(pollingUnits.wardId, wards.id))
      .where(eq(lgas.code, lgaCode))
      .groupBy(wards.id)
      .orderBy(asc(wards.code));
  }

  listUnits(wardCode: string) {
    return this.db
      .select({ code: pollingUnits.code, name: pollingUnits.name, registeredVoters: pollingUnits.registeredVoters })
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .where(eq(wards.code, wardCode))
      .orderBy(asc(pollingUnits.code));
  }

  /** Resolves any polling unit code to its full place in the hierarchy (CNT-01). */
  async getUnit(rawCode: string) {
    const parsed = parseUnitCode(rawCode);
    if (!parsed) throw new NotFoundException('Not a valid polling unit code');
    const [row] = await this.db
      .select({
        code: pollingUnits.code,
        name: pollingUnits.name,
        registeredVoters: pollingUnits.registeredVoters,
        ward: { code: wards.code, name: wards.name },
        lga: { code: lgas.code, name: lgas.name },
        state: { code: states.code, name: states.name },
      })
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .innerJoin(states, eq(states.id, lgas.stateId))
      .where(eq(pollingUnits.code, parsed.unit))
      .limit(1);
    if (!row) throw new NotFoundException('Polling unit not found in the register');
    return row;
  }
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}

function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
