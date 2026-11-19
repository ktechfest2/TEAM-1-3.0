import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { parseUnitCode } from '@trustelect/shared';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AdminRole } from '../auth/auth.service.js';
import type { Database } from '../database/database.module.js';
import { adminUsers, auditLog, declarations, elections, incidentReports, pollingUnits, submissions, unitResults } from '../database/schema.js';
import { INCIDENT_TYPES, SERIOUS } from '../incidents/rules.js';
import { TallyService } from '../tally/tally.service.js';

export type Alert = { level: 'critical' | 'warning'; code: string; title: string; detail: string; link?: string };

const SPIKE_WINDOW_MS = 30 * 60_000;
const BASELINE_WINDOW_MS = 2 * 3_600_000;

/** A spike: at least `min` in the last 30 minutes and at least 3× the usual rate of the 2 hours before */
export function isSpike(recent: number, before: number, min: number) {
  const usual = before / (BASELINE_WINDOW_MS / SPIKE_WINDOW_MS);
  return recent >= min && recent >= 3 * Math.max(usual, 1);
}

const SERIOUS_TYPES = [...SERIOUS];

/** Operations console (Sprint 14): election-day dashboard, review at scale, alerts and audit (ADM-01, ADM-02, ADM-06). */
@Injectable()
export class OpsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tally: TallyService,
  ) {}

  /* -------------------------------- dashboard -------------------------------- */

  async dashboard(electionId: string) {
    const [election] = await this.db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
    if (!election) throw new NotFoundException('Election not found');
    const t = await this.tally.area(electionId);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const activity = await this.db
      .select({ status: submissions.status, kind: submissions.kind, n: count() })
      .from(submissions)
      .where(and(eq(submissions.electionId, electionId), gt(submissions.receivedAt, hourAgo)))
      .groupBy(submissions.status, submissions.kind);
    const [backlog] = await this.db
      .select({ n: count(), oldest: sql<Date | null>`min(${submissions.receivedAt})` })
      .from(submissions)
      .where(and(eq(submissions.electionId, electionId), eq(submissions.status, 'pending')));
    const review = await this.db
      .select({ status: unitResults.status, assigned: sql<boolean>`${unitResults.assignedTo} is not null`, n: count() })
      .from(unitResults)
      .where(and(eq(unitResults.electionId, electionId), isNotNull(unitResults.reviewSince)))
      .groupBy(unitResults.status, sql`${unitResults.assignedTo} is not null`);
    const scope = election.scopeLevel === 'national' ? null : election.scopeCode;
    const inScope = scope ? sql`${pollingUnits.code} like ${`${scope}%`}` : undefined;
    const incidents = await this.db
      .select({ label: incidentReports.label, status: incidentReports.status, n: count() })
      .from(incidentReports)
      .innerJoin(pollingUnits, eq(pollingUnits.id, incidentReports.pollingUnitId))
      .where(and(gt(incidentReports.receivedAt, new Date(Date.now() - 86_400_000)), inScope))
      .groupBy(incidentReports.label, incidentReports.status);
    return {
      election: { id: election.id, title: election.title, status: election.status, scopeLevel: election.scopeLevel, scopeCode: election.scopeCode },
      generatedAt: new Date().toISOString(),
      totals: { ...t.totals, partyVotes: undefined },
      areas: t.children.map((c) => ({ code: c.code, name: c.name, countedUnits: c.countedUnits, totalUnits: c.totalUnits, mix: c.mix, comparison: c.comparison?.status ?? null })),
      areaLevel: t.childLevel,
      lastHour: activity,
      backlog: { pending: backlog.n, oldest: backlog.oldest },
      review,
      incidents,
      alerts: await this.alerts(electionId, t),
    };
  }

  async alerts(electionId: string, t?: Awaited<ReturnType<TallyService['area']>>): Promise<Alert[]> {
    const now = Date.now();
    const recentFrom = new Date(now - SPIKE_WINDOW_MS);
    const baseFrom = new Date(now - SPIKE_WINDOW_MS - BASELINE_WINDOW_MS);
    const alerts: Alert[] = [];
    const window = async (column: typeof unitResults.reviewSince | typeof submissions.processedAt, where: SQL | undefined, table: 'units' | 'rejected') => {
      const q = (from: Date, to: Date) =>
        table === 'units'
          ? this.db.select({ n: count() }).from(unitResults).where(and(where, gte(column, from), lt(column, to)))
          : this.db.select({ n: count() }).from(submissions).where(and(where, gte(column, from), lt(column, to)));
      const [[r], [b]] = await Promise.all([q(recentFrom, new Date(now)), q(baseFrom, recentFrom)]);
      return { recent: r.n, before: b.n };
    };

    const disputes = await window(unitResults.reviewSince, and(eq(unitResults.electionId, electionId), inArray(unitResults.status, ['provisional', 'disputed'])), 'units');
    if (isSpike(disputes.recent, disputes.before, 5)) {
      alerts.push({ level: 'critical', code: 'dispute_spike', title: 'Spike in disputed units', detail: `${disputes.recent} units became provisional or disputed in the last 30 minutes.`, link: '/admin/ops' });
    }
    const rejected = await window(submissions.processedAt, and(eq(submissions.electionId, electionId), eq(submissions.status, 'rejected')), 'rejected');
    if (isSpike(rejected.recent, rejected.before, 10)) {
      alerts.push({ level: 'warning', code: 'rejection_spike', title: 'Spike in rejected photos', detail: `${rejected.recent} photos rejected in the last 30 minutes. Check the abuse page.`, link: '/admin/abuse' });
    }

    const tally = t ?? (await this.tally.area(electionId));
    const mismatched = [tally.totals, ...tally.children].filter((a) => a.comparison?.status === 'does_not_match').map((a) => a.name);
    if (mismatched.length) {
      alerts.push({ level: 'critical', code: 'mismatch', title: 'Declared result does not match', detail: `Citizen results do not match the declaration for ${mismatched.join(', ')}.`, link: `/results/election?id=${electionId}` });
    }

    const [held] = await this.db
      .select({ n: count(), oldest: sql<Date | null>`min(${incidentReports.receivedAt})` })
      .from(incidentReports)
      .where(and(eq(incidentReports.status, 'held'), inArray(incidentReports.type, SERIOUS_TYPES)));
    if (held.n) {
      const waited = held.oldest ? (now - new Date(held.oldest).getTime()) / 60_000 : 0;
      alerts.push({
        level: waited > 15 ? 'critical' : 'warning',
        code: 'serious_incidents',
        title: 'Serious incident reports waiting',
        detail: `${held.n} serious ${held.n === 1 ? 'report is' : 'reports are'} held for review; the oldest has waited ${Math.round(waited)} minutes.`,
        link: '/admin/incidents',
      });
    }

    const [stuck] = await this.db
      .select({ n: count() })
      .from(submissions)
      .where(and(eq(submissions.electionId, electionId), eq(submissions.status, 'pending'), lt(submissions.receivedAt, new Date(now - 5 * 60_000))));
    if (stuck.n >= 10) {
      alerts.push({ level: 'warning', code: 'verification_backlog', title: 'Photo checks are falling behind', detail: `${stuck.n} photos have waited more than 5 minutes to be checked. The AI provider may be slow or failing.` });
    }
    return alerts;
  }

  /* ------------------------------ review at scale ----------------------------- */

  /** One queue for everything that needs a person, most urgent and oldest first */
  async queue() {
    const assignee = alias(adminUsers, 'assignee');
    const units = await this.db
      .select({
        electionId: elections.id,
        electionTitle: elections.title,
        unitCode: pollingUnits.code,
        unitName: pollingUnits.name,
        status: unitResults.status,
        flags: unitResults.flags,
        since: unitResults.reviewSince,
        assignedTo: unitResults.assignedTo,
        assignee: assignee.displayName,
      })
      .from(unitResults)
      .innerJoin(elections, eq(elections.id, unitResults.electionId))
      .innerJoin(pollingUnits, eq(pollingUnits.id, unitResults.pollingUnitId))
      .leftJoin(assignee, eq(assignee.id, unitResults.assignedTo))
      .where(and(isNotNull(unitResults.reviewSince), or(inArray(unitResults.status, ['provisional', 'disputed']), sql`jsonb_array_length(${unitResults.flags}) > 0`)))
      .limit(500);
    const incidents = await this.db
      .select({
        id: incidentReports.id,
        reference: incidentReports.reference,
        type: incidentReports.type,
        unitCode: pollingUnits.code,
        since: incidentReports.receivedAt,
        assignedTo: incidentReports.assignedTo,
        assignee: assignee.displayName,
      })
      .from(incidentReports)
      .innerJoin(pollingUnits, eq(pollingUnits.id, incidentReports.pollingUnitId))
      .leftJoin(assignee, eq(assignee.id, incidentReports.assignedTo))
      .where(eq(incidentReports.status, 'held'))
      .limit(500);
    const pendingDeclarations = await this.db
      .select({ id: declarations.id, level: declarations.level, areaCode: declarations.areaCode, since: declarations.createdAt, electionTitle: elections.title })
      .from(declarations)
      .innerJoin(elections, eq(elections.id, declarations.electionId))
      .where(eq(declarations.status, 'pending'))
      .limit(200);

    type Item = { kind: 'unit' | 'incident' | 'declaration'; priority: number; key: string; title: string; detail: string; since: Date; assignedTo: string | null; assignee: string | null; link: string };
    const items: Item[] = [
      ...units.map((u) => ({
        kind: 'unit' as const,
        priority: u.status === 'disputed' ? 0 : u.status === 'provisional' ? 2 : 4,
        key: `${u.electionId}:${u.unitCode}`,
        title: `${u.unitCode} ${u.unitName}`,
        detail: `${u.electionTitle} · ${u.status}${u.flags.length ? ` · ${u.flags.join(', ')}` : ''}`,
        since: u.since!,
        assignedTo: u.assignedTo,
        assignee: u.assignee,
        link: `/admin/review/unit?election=${u.electionId}&code=${u.unitCode}`,
      })),
      ...incidents.map((i) => ({
        kind: 'incident' as const,
        priority: SERIOUS.has(i.type) ? 1 : 3,
        key: i.id,
        title: `${i.reference} ${INCIDENT_TYPES[i.type]}`,
        detail: `Incident at ${i.unitCode}`,
        since: i.since,
        assignedTo: i.assignedTo,
        assignee: i.assignee,
        link: '/admin/incidents',
      })),
      ...pendingDeclarations.map((d) => ({
        kind: 'declaration' as const,
        priority: 3,
        key: d.id,
        title: `Declaration: ${d.level}${d.areaCode ? ` ${d.areaCode}` : ''}`,
        detail: `${d.electionTitle} · waiting for a second administrator`,
        since: d.since,
        assignedTo: null,
        assignee: null,
        link: '/admin/declarations',
      })),
    ];
    return items.sort((a, b) => a.priority - b.priority || a.since.getTime() - b.since.getTime());
  }

  /**
   * Claim, release or assign an item. Reviewers claim for themselves or release their own;
   * system administrators assign to anyone.
   */
  async assign(input: { kind: 'unit' | 'incident'; key: string; to: string | null }, actor: { id: string; role: AdminRole }) {
    if (actor.role !== 'system_admin' && input.to !== null && input.to !== actor.id) throw new ForbiddenException('You can only claim items for yourself');
    if (input.to) {
      const [target] = await this.db.select({ role: adminUsers.role, disabledAt: adminUsers.disabledAt }).from(adminUsers).where(eq(adminUsers.id, input.to)).limit(1);
      if (!target || target.disabledAt || !['reviewer', 'system_admin'].includes(target.role)) throw new BadRequestException('Assign to an active reviewer');
    }
    const set = { assignedTo: input.to, assignedAt: input.to ? new Date() : null };
    if (input.kind === 'unit') {
      const [electionId, code] = input.key.split(':');
      const unit = parseUnitCode(code ?? '');
      const [pu] = unit ? await this.db.select({ id: pollingUnits.id }).from(pollingUnits).where(eq(pollingUnits.code, unit.unit)).limit(1) : [];
      if (!pu) throw new NotFoundException('Polling unit not found');
      const where = and(eq(unitResults.electionId, electionId), eq(unitResults.pollingUnitId, pu.id));
      const [current] = await this.db.select({ assignedTo: unitResults.assignedTo }).from(unitResults).where(where).limit(1);
      if (!current) throw new NotFoundException('No result for this polling unit');
      if (actor.role !== 'system_admin' && input.to === null && current.assignedTo !== actor.id) throw new ForbiddenException('You can only release your own items');
      await this.db.update(unitResults).set(set).where(where);
    } else {
      const [current] = await this.db.select({ assignedTo: incidentReports.assignedTo }).from(incidentReports).where(eq(incidentReports.id, input.key)).limit(1);
      if (!current) throw new NotFoundException('Report not found');
      if (actor.role !== 'system_admin' && input.to === null && current.assignedTo !== actor.id) throw new ForbiddenException('You can only release your own items');
      await this.db.update(incidentReports).set(set).where(eq(incidentReports.id, input.key));
    }
    return { ok: true };
  }

  /** Per reviewer: open items, decisions in the last 24 hours, and median turnaround over 7 days */
  async workload() {
    const reviewers = await this.db
      .select({ id: adminUsers.id, name: adminUsers.displayName, role: adminUsers.role })
      .from(adminUsers)
      .where(and(inArray(adminUsers.role, ['reviewer', 'system_admin']), isNull(adminUsers.disabledAt)))
      .orderBy(asc(adminUsers.displayName));
    const day = new Date(Date.now() - 86_400_000);
    const week = new Date(Date.now() - 7 * 86_400_000);
    const openUnits = await this.db.select({ id: unitResults.assignedTo, n: count() }).from(unitResults).where(and(isNotNull(unitResults.assignedTo), isNotNull(unitResults.reviewSince))).groupBy(unitResults.assignedTo);
    const openIncidents = await this.db.select({ id: incidentReports.assignedTo, n: count() }).from(incidentReports).where(and(isNotNull(incidentReports.assignedTo), eq(incidentReports.status, 'held'))).groupBy(incidentReports.assignedTo);
    const unitDone = await this.db
      .select({ id: unitResults.resolvedBy, at: unitResults.resolvedAt, since: unitResults.reviewSince })
      .from(unitResults)
      .where(and(isNotNull(unitResults.resolvedAt), gte(unitResults.resolvedAt, week)));
    const incidentDone = await this.db
      .select({ id: incidentReports.reviewedBy, at: incidentReports.reviewedAt, since: incidentReports.receivedAt })
      .from(incidentReports)
      .where(and(isNotNull(incidentReports.reviewedAt), gte(incidentReports.reviewedAt, week)));
    const done = [...unitDone, ...incidentDone].filter((d) => d.id && d.at && d.since);
    const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
    return reviewers.map((r) => {
      const mine = done.filter((d) => d.id === r.id);
      return {
        ...r,
        open: (openUnits.find((o) => o.id === r.id)?.n ?? 0) + (openIncidents.find((o) => o.id === r.id)?.n ?? 0),
        decidedToday: mine.filter((d) => d.at! >= day).length,
        medianMinutes: median(mine.map((d) => (d.at!.getTime() - d.since!.getTime()) / 60_000)),
      };
    });
  }

  /* ---------------------------------- audit ---------------------------------- */

  /** ADM-06: searchable audit log, newest first, 100 at a time */
  async audit(f: { q?: string; action?: string; adminId?: string; from?: string; to?: string; before?: number }) {
    const where: (SQL | undefined)[] = [];
    if (f.action) where.push(ilike(auditLog.action, `${f.action}%`));
    if (f.adminId) where.push(eq(auditLog.adminUserId, f.adminId));
    if (f.from) where.push(gte(auditLog.createdAt, new Date(f.from)));
    if (f.to) where.push(lte(auditLog.createdAt, new Date(f.to)));
    if (f.before) where.push(lt(auditLog.id, f.before));
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(auditLog.action, like), ilike(auditLog.targetId, like), sql`${auditLog.details}::text ilike ${like}`, ilike(adminUsers.displayName, like)));
    }
    const rows = await this.db
      .select({ id: auditLog.id, at: auditLog.createdAt, action: auditLog.action, targetType: auditLog.targetType, targetId: auditLog.targetId, details: auditLog.details, admin: adminUsers.displayName })
      .from(auditLog)
      .leftJoin(adminUsers, eq(adminUsers.id, auditLog.adminUserId))
      .where(and(...where))
      .orderBy(desc(auditLog.id))
      .limit(100);
    return { rows, next: rows.length === 100 ? rows.at(-1)!.id : null };
  }
}
