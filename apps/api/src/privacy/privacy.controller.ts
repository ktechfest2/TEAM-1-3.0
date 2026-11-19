import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { PrivacyService } from './privacy.service.js';

/** Data protection and access review: system administrators only */
@Controller('admin/privacy')
@UseGuards(SessionGuard)
@Roles('system_admin')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post('erase')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  erase(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.privacy.erase(parseOrThrow(z.object({ phone: z.string().min(7).max(20) }), body).phone, admin.id);
  }

  @Get('access')
  access() {
    return this.privacy.accessReview();
  }

  @Post('admins/:id/:action')
  @HttpCode(200)
  setDisabled(@Param('id') id: string, @Param('action') action: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const a = parseOrThrow(z.enum(['disable', 'enable']), action);
    const { reason } = parseOrThrow(z.object({ reason: z.string().trim().min(5).max(500) }), body);
    return this.privacy.setDisabled(parseOrThrow(z.uuid(), id), a === 'disable', reason, admin.id);
  }

  /** Runs the retention job now (it also runs every 6 hours) */
  @Post('retention')
  @HttpCode(200)
  retention() {
    return this.privacy.runRetention();
  }
}
