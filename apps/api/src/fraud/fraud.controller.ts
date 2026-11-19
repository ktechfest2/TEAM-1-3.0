import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { FraudService } from './fraud.service.js';

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** Abuse dashboard and blocking (ADM-02, ADM-03) */
@Controller('admin/abuse')
@UseGuards(SessionGuard)
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get()
  clusters() {
    return this.fraud.clusters();
  }

  @Get('blocked')
  blocked() {
    return this.fraud.blocked();
  }

  @Post('numbers/:id/block')
  @HttpCode(200)
  @Roles('reviewer')
  block(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.fraud.block(parseOrThrow(z.uuid(), id), parseOrThrow(reasonSchema, body).reason, admin.id);
  }

  @Post('numbers/:id/unblock')
  @HttpCode(200)
  @Roles('reviewer')
  unblock(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.fraud.unblock(parseOrThrow(z.uuid(), id), parseOrThrow(reasonSchema, body).reason, admin.id);
  }
}
