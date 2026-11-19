import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { parseUnitCode } from '@trustelect/shared';
import { and, count, desc, eq, gt, gte, lte, ne, or, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { imageType } from '../capture/capture.service.js';
import { ChainService } from '../chain/chain.service.js';
import type { Database } from '../database/database.module.js';
import { incidentReports, lgas, pollingUnits, submissions, wards } from '../database/schema.js';
import { sha256 } from '../security/encryption.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { IncidentAssessor } from './assessor.js';
import { decideLabel, DANGER, INCIDENT_LABELS, INCIDENT_TYPES, newReference, type Assessment, type IncidentLabel, type IncidentType } from './rules.js';

const PER_HOUR = 5;
/** Reports of the same type at the same unit within this window corroborate each other */
const CORROBORATION_WINDOW_MS = 3 * 3_600_000;
export const MAX_EVIDENCE_BYTES = 6 * 1024 * 1024;

export const incidentQuerySchema = z.object({
  type: z.enum(Object.keys(INCIDENT_TYPES) as [IncidentType, ...IncidentType[]]),
  unitCode: z.string().min(7).max(20),
  claim: z.string().trim().min(10).max(280),
  clientId: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).max(100_000).optional(),
});
export type IncidentInput = z.infer<typeof incidentQuerySchema> & { channel: 'web' | 'whatsapp' };

export const reviewSchema = z.object({
  label: z.enum(['supported', 'partly_supported', 'not_supported', 'unconfirmed']),
  publish: z.boolean(),
  note: z.string().trim().min(5).max(1000),
});

/** Incident reports (Sprint 12, INC-01 to INC-06). */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger('Incidents');
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly storage: EvidenceStorage,
    private readonly assessor: IncidentAssessor,
    private readonly chain: ChainService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Accepts a report with its evidence photo, gives it a reference number and queues the
   * assessment. Idempotent per clientId (the phone may retry).
   */
  async submit(reporterId: string, input: IncidentInput, bytes: Buffer) {
    const type = imageType(bytes);
    if (!type) throw new BadRequestException('The evidence must be a JPEG or WebP photo');
    if (bytes.length > MAX_EVIDENCE_BYTES) throw new HttpException('The photo is too large', HttpStatus.PAYLOAD_TOO_LARGE);
    const unit = parseUnitCode(input.unitCode);
    const [row] = unit ? await this.db.select({ id: pollingUnits.id }).from(pollingUnits).where(eq(pollingUnits.code, unit.unit)).limit(1) : [];
    if (!row) throw new BadRequestException(`${input.unitCode} is not in the polling unit register`);

    const [existing] = await this.db
      .select()
      .from(incidentReports)
      .where(and(eq(incidentReports.reporterId, reporterId), eq(incidentReports.clientId, input.clientId)))
      .limit(1);
    if (existing) return this.receipt(existing.reference, existing.type);

    const [{ recent }] = await this.db
      .select({ recent: count() })
      .from(incidentReports)
      .where(and(eq(incidentReports.reporterId, reporterId), gt(incidentReports.receivedAt, new Date(Date.now() - 3_600_000))));
    if (recent >= PER_HOUR) throw new HttpException('Too many reports from this number in the last hour. Try again later.', HttpStatus.TOO_MANY_REQUESTS);

    const digest = sha256(bytes);
    const key = await this.storage.put(digest, bytes, type === 'image/webp' ? 'webp' : 'jpg');
    const now = Date.now();
    const capturedAt = input.capturedAt && new Date(input.capturedAt).getTime() <= now + 300_000 ? new Date(input.capturedAt) : null;
    let reference = newReference(randomBytes);
    for (let i = 0; i < 3; i++) {
      const [clash] = await this.db.select({ id: incidentReports.id }).from(incidentReports).where(eq(incidentReports.reference, reference)).limit(1);
      if (!clash) break;
      reference = newReference(randomBytes);
    }
    const [report] = await this.db
      .insert(incidentReports)
      .values({
        reference,
        pollingUnitId: row.id,
        reporterId,
        type: input.type,
        claim: input.claim,
        channel: input.channel,
        capturedAt,
        latitude: input.lat ?? null,
        longitude: input.lng ?? null,
        locationAccuracy: input.accuracy ?? null,
        evidenceKey: key,
        evidenceSha256: digest,
        evidenceType: type,
        clientId: input.clientId,
      })
      .returning();
    await this.chain.syncIncident(report.id);
    this.queue = this.queue.then(() => this.assess(report.id).catch((err: Error) => this.logger.error(`incident ${report.id}: ${err.message}`)));
    return this.receipt(report.reference, report.type);
  }

  private receipt(reference: string, type: IncidentType) {
    return { reference, emergency: DANGER.has(type) };
  }

  /** Resolves when queued assessments are done (tests) */
  idle() {
    return this.queue;
  }

  /** INC-03, INC-04, INC-05: assess the evidence, then label (and publish or hold) the report and its corroborating reports */
  async assess(id: string) {
    const [r] = await this.db.select().from(incidentReports).where(eq(incidentReports.id, id)).limit(1);
    if (!r || !r.evidenceKey) return;
    const assessment = await this.assessor.assess(await this.storage.get(r.evidenceKey), r.evidenceType, r.type, r.claim);
    await this.db.update(incidentReports).set({ assessment: { ai: assessment } }).where(eq(incidentReports.id, id));
    await this.relabelGroup(r.pollingUnitId, r.type, r.receivedAt);
  }

  /** Recomputes corroboration and labels for reports of one type at one unit around one time */
  private async relabelGroup(pollingUnitId: number, type: IncidentType, around: Date) {
    const group = await this.db
      .select()
      .from(incidentReports)
      .where(
        and(
          eq(incidentReports.pollingUnitId, pollingUnitId),
          eq(incidentReports.type, type),
          gte(incidentReports.receivedAt, new Date(around.getTime() - CORROBORATION_WINDOW_MS)),
          lte(incidentReports.receivedAt, new Date(around.getTime() + CORROBORATION_WINDOW_MS)),
        ),
      );
    for (const r of group) {
      if (r.reviewedAt) continue; // a reviewer's decision stands
      const ai = (r.assessment as { ai?: Assessment | null } | null)?.ai ?? null;
      if (!r.assessment) continue; // not assessed yet
      const others = new Set(group.filter((o) => o.id !== r.id && o.reporterId !== r.reporterId && o.status !== 'hidden').map((o) => o.reporterId)).size;
      const reused = await this.isReused(r.id, r.evidenceSha256, r.reporterId);
      const decision = decideLabel({ type: r.type, channel: r.channel === 'web' ? 'web' : 'whatsapp', assessment: ai, reused, corroboration: others });
      await this.db
        .update(incidentReports)
        .set({
          label: decision.label,
          status: decision.status,
          corroboration: others,
          assessment: { ai, reused, suggestedLabel: decision.suggested },
          publishedAt: decision.status === 'published' ? (r.publishedAt ?? new Date()) : null,
        })
        .where(eq(incidentReports.id, r.id));
      await this.chain.syncIncident(r.id);
    }
  }

  /** The same image in another report by someone else, or used as a result photo */
  private async isReused(id: string, digest: string, reporterId: string) {
    const [other] = await this.db
      .select({ id: incidentReports.id })
      .from(incidentReports)
      .where(and(eq(incidentReports.evidenceSha256, digest), ne(incidentReports.id, id), ne(incidentReports.reporterId, reporterId)))
      .limit(1);
    if (other) return true;
    const [photo] = await this.db.select({ id: submissions.id }).from(submissions).where(eq(submissions.imageSha256, digest)).limit(1);
    return !!photo;
  }

  /* ------------------------------- public views ------------------------------ */

  /** INC-04: the sender follows the label with the reference number */
  async byReference(reference: string) {
    const [r] = await this.db
      .select({ reference: incidentReports.reference, type: incidentReports.type, label: incidentReports.label, status: incidentReports.status, unitCode: pollingUnits.code, receivedAt: incidentReports.receivedAt })
      .from(incidentReports)
      .innerJoin(pollingUnits, eq(pollingUnits.id, incidentReports.pollingUnitId))
      .where(eq(incidentReports.reference, reference.toUpperCase()))
      .limit(1);
    if (!r) throw new NotFoundException('No report with that reference');
    return { ...r, labelText: INCIDENT_LABELS[r.label], typeText: INCIDENT_TYPES[r.type], published: r.status === 'published' };
  }

  /** Published reports, newest first; never who sent them */
  async published(filter: { code?: string; limit: number }) {
    const where = [eq(incidentReports.status, 'published')];
    if (filter.code) where.push(sql`${pollingUnits.code} like ${`${filter.code}%`}`);
    const rows = await this.db
      .select({
        reference: incidentReports.reference,
        type: incidentReports.type,
        claim: incidentReports.claim,
        label: incidentReports.label,
        channel: incidentReports.channel,
        corroboration: incidentReports.corroboration,
        receivedAt: incidentReports.receivedAt,
        unitCode: pollingUnits.code,
        unitName: pollingUnits.name,
        wardName: wards.name,
        lgaName: lgas.name,
      })
      .from(incidentReports)
      .innerJoin(pollingUnits, eq(pollingUnits.id, incidentReports.pollingUnitId))
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .where(and(...where))
      .orderBy(desc(incidentReports.receivedAt))
      .limit(filter.limit);
    return rows.map((r) => ({ ...r, labelText: INCIDENT_LABELS[r.label], typeText: INCIDENT_TYPES[r.type] }));
  }

  /* --------------------------------- review --------------------------------- */

  async queueForReview(scope: 'held' | 'all') {
    const rows = await this.db
      .select({
        id: incidentReports.id,
        reference: incidentReports.reference,
        type: incidentReports.type,
        claim: incidentReports.claim,
        channel: incidentReports.channel,
        status: incidentReports.status,
        label: incidentReports.label,
        assessment: incidentReports.assessment,
        corroboration: incidentReports.corroboration,
        receivedAt: incidentReports.receivedAt,
        capturedAt: incidentReports.capturedAt,
        reviewNote: incidentReports.reviewNote,
        unitCode: pollingUnits.code,
        unitName: pollingUnits.name,
      })
      .from(incidentReports)
      .innerJoin(pollingUnits, eq(pollingUnits.id, incidentReports.pollingUnitId))
      .where(scope === 'held' ? or(eq(incidentReports.status, 'held'), eq(incidentReports.status, 'pending')) : undefined)
      .orderBy(desc(incidentReports.receivedAt))
      .limit(200);
    return rows.map((r) => ({ ...r, typeText: INCIDENT_TYPES[r.type], labelText: INCIDENT_LABELS[r.label] }));
  }

  async evidenceKey(id: string) {
    const [r] = await this.db.select({ key: incidentReports.evidenceKey }).from(incidentReports).where(eq(incidentReports.id, id)).limit(1);
    if (!r?.key) throw new NotFoundException('No evidence for this report');
    return r.key;
  }

  /** A reviewer sets the label and decides publication (INC-05) */
  async review(id: string, input: z.infer<typeof reviewSchema>, adminId: string) {
    const [r] = await this.db.select().from(incidentReports).where(eq(incidentReports.id, id)).limit(1);
    if (!r) throw new NotFoundException('Report not found');
    if (r.status === 'pending') throw new ConflictException('This report is still being assessed');
    const label: IncidentLabel = input.label;
    await this.db
      .update(incidentReports)
      .set({
        label,
        status: input.publish ? 'published' : 'hidden',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewNote: input.note,
        publishedAt: input.publish ? (r.publishedAt ?? new Date()) : null,
      })
      .where(eq(incidentReports.id, id));
    await this.chain.syncIncident(id);
    await this.audit.record({ adminUserId: adminId, action: 'incident.reviewed', targetType: 'incident', targetId: id, details: { ...input } });
    // Hiding or confirming one report changes the corroboration of the others
    await this.relabelGroup(r.pollingUnitId, r.type, r.receivedAt);
    return { id, label, status: input.publish ? 'published' : 'hidden' };
  }
}
