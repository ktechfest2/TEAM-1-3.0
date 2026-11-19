import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { WitnessService } from '../witnesses/witness.service.js';
import { ResultsService } from './results.service.js';

/** Public, read-only results. */
@Controller('results')
export class PublicResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('units/:code')
  @Header('Cache-Control', 'public, max-age=15')
  unit(@Param('code') code: string) {
    return this.results.publicUnitResults(code);
  }
}

const resolveSchema = z.object({
  electionId: z.uuid(),
  unitCode: z.string().min(7).max(20),
  versionId: z.uuid(),
  reason: z.string().trim().min(10, 'Explain the decision in at least 10 characters').max(1000),
});

/** Admin review of polling unit results (WIT-08, ADM-01). */
@Controller('admin/review')
@UseGuards(SessionGuard)
export class AdminReviewController {
  constructor(
    private readonly results: ResultsService,
    private readonly witnesses: WitnessService,
    private readonly storage: EvidenceStorage,
    private readonly audit: AuditService,
  ) {}

  @Get('queue')
  queue() {
    return this.results.reviewQueue();
  }

  @Get('elections/:electionId/units/:code')
  unit(@Param('electionId') electionId: string, @Param('code') code: string) {
    parseOrThrow(z.uuid(), electionId);
    return this.results.unitDetail(electionId, code);
  }

  /** Streams an evidence photo to a signed-in reviewer. Every view is recorded. */
  @Get('photos/:id')
  @Header('Cache-Control', 'private, no-store')
  async photo(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin, @Res({ passthrough: true }) res: Response) {
    parseOrThrow(z.uuid(), id);
    const { key, type } = await this.results.imageKey(id);
    await this.audit.record({ adminUserId: admin.id, action: 'evidence.viewed', targetType: 'submission', targetId: id });
    res.setHeader('Content-Type', type ?? 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.storage.get(key));
  }

  @Post('resolve')
  @HttpCode(200)
  @Roles('reviewer')
  async resolve(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const input = parseOrThrow(resolveSchema, body);
    await this.witnesses.resolve(input, admin.id);
    return this.results.unitDetail(input.electionId, input.unitCode);
  }
}
