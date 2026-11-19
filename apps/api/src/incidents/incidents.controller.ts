import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { CaptureSessionGuard, CurrentVoter } from '../capture/capture.controller.js';
import type { CaptureVoter } from '../capture/capture.service.js';
import { parseOrThrow } from '../common/validation.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { incidentQuerySchema, IncidentsService, reviewSchema } from './incidents.service.js';

/** Public side: report (with the voter's capture session), list published reports, follow a reference. */
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  /** Body: the raw evidence photo (live camera). Details in the query string. */
  @Post()
  @UseGuards(CaptureSessionGuard, ThrottlerGuard)
  // Generous per IP (shared mobile IPs); each number is limited to 5 reports an hour
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  report(@CurrentVoter() voter: CaptureVoter, @Query() query: unknown, @Req() req: Request) {
    const q = parseOrThrow(incidentQuerySchema, query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new BadRequestException('Send the evidence photo as image/jpeg or image/webp');
    return this.incidents.submit(voter.reporterId, { ...q, channel: 'web' }, req.body);
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  list(@Query() query: unknown) {
    const q = parseOrThrow(z.object({ code: z.string().regex(/^[\d-]{2,12}$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), query);
    return this.incidents.published(q);
  }

  @Get('ref/:reference')
  @Header('Cache-Control', 'no-store')
  byReference(@Param('reference') reference: string) {
    return this.incidents.byReference(parseOrThrow(z.string().regex(/^TE-[A-Za-z0-9]{6}$/), reference));
  }
}

/** Review of held reports (ADM-01, INC-05). */
@Controller('admin/incidents')
@UseGuards(SessionGuard)
export class AdminIncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly storage: EvidenceStorage,
  ) {}

  @Get()
  list(@Query() query: unknown) {
    const { scope } = parseOrThrow(z.object({ scope: z.enum(['held', 'all']).default('held') }), query);
    return this.incidents.queueForReview(scope);
  }

  @Get(':id/evidence')
  @Header('Cache-Control', 'private, no-store')
  async evidence(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const key = await this.incidents.evidenceKey(parseOrThrow(z.uuid(), id));
    res.setHeader('Content-Type', key.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.storage.get(key));
  }

  @Post(':id/review')
  @HttpCode(200)
  @Roles('reviewer')
  review(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.incidents.review(parseOrThrow(z.uuid(), id), parseOrThrow(reviewSchema, body), admin.id);
  }
}
