import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { OpsService } from './ops.service.js';

/** Operations console (ADM-01, ADM-02, ADM-06) */
@Controller('admin/ops')
@UseGuards(SessionGuard)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('dashboard')
  dashboard(@Query() query: unknown) {
    return this.ops.dashboard(parseOrThrow(z.object({ electionId: z.uuid() }), query).electionId);
  }

  @Get('queue')
  queue() {
    return this.ops.queue();
  }

  @Post('assign')
  @HttpCode(200)
  @Roles('reviewer')
  assign(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const input = parseOrThrow(z.object({ kind: z.enum(['unit', 'incident']), key: z.string().min(3).max(120), to: z.uuid().nullable() }), body);
    return this.ops.assign(input, admin);
  }

  @Get('workload')
  workload() {
    return this.ops.workload();
  }

  /** Audit entries can hold IP addresses: system administrators only */
  @Get('audit')
  @Roles('system_admin')
  audit(@Query() query: unknown) {
    return this.ops.audit(
      parseOrThrow(
        z.object({
          q: z.string().trim().min(1).max(100).optional(),
          action: z.string().regex(/^[a-z_.]{1,60}$/).optional(),
          adminId: z.uuid().optional(),
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
          before: z.coerce.number().int().positive().optional(),
        }),
        query,
      ),
    );
  }
}
