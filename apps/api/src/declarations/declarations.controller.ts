import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { createDeclarationSchema, DeclarationsService } from './declarations.service.js';

/** Declared results (CMP-01 to CMP-04): entered by one administrator, approved by another. */
@Controller('admin/declarations')
@UseGuards(SessionGuard)
export class DeclarationsController {
  constructor(
    private readonly declarations: DeclarationsService,
    private readonly storage: EvidenceStorage,
  ) {}

  @Get()
  list(@Query() query: unknown) {
    const q = parseOrThrow(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), electionId: z.uuid().optional() }), query);
    return this.declarations.list(q);
  }

  /** Body: raw JPEG or WebP of the source document. Returns its storage key and an AI prefill. */
  @Post('source')
  @HttpCode(200)
  @Roles('declarations_admin')
  upload(@Query() query: unknown, @Req() req: Request, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const { electionId } = parseOrThrow(z.object({ electionId: z.uuid() }), query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new BadRequestException('Send the source photo as image/jpeg or image/webp');
    }
    return this.declarations.uploadSource(electionId, req.body, admin.id);
  }

  @Post()
  @Roles('declarations_admin')
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.declarations.create(parseOrThrow(createDeclarationSchema, body), admin.id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('approver')
  approve(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    parseOrThrow(z.uuid(), id);
    return this.declarations.approve(id, admin.id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('approver')
  reject(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    parseOrThrow(z.uuid(), id);
    const { reason } = parseOrThrow(z.object({ reason: z.string().trim().min(10).max(1000) }), body);
    return this.declarations.reject(id, admin.id, reason);
  }

  @Get(':id/source')
  @Header('Cache-Control', 'private, no-store')
  async source(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    parseOrThrow(z.uuid(), id);
    const key = await this.declarations.sourceKey(id);
    res.setHeader('Content-Type', key.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.storage.get(key));
  }
}
