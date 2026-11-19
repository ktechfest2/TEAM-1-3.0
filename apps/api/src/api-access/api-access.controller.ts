import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { ApiKeysService, registerSchema } from './api-keys.service.js';

/** Registration for an API key (from the /developers page). */
@Controller('developers')
export class DevelopersController {
  constructor(private readonly keys: ApiKeysService) {}

  /** Returns the key once. It works after a TrustElect administrator approves it. */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  register(@Body() body: unknown) {
    return this.keys.register(parseOrThrow(registerSchema, body));
  }
}

const noteSchema = z.object({ note: z.string().trim().max(500).nullish() });

/** Approving, rejecting and revoking API keys (system administrators). */
@Controller('admin/api-clients')
@UseGuards(SessionGuard)
@Roles('system_admin')
export class AdminApiClientsController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list() {
    return this.keys.list();
  }

  @Post(':id/:action')
  @HttpCode(200)
  decide(@Param('id') id: string, @Param('action') action: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    parseOrThrow(z.uuid(), id);
    const act = parseOrThrow(z.enum(['approve', 'reject', 'revoke']), action);
    return this.keys.decide(id, act, admin.id, parseOrThrow(noteSchema, body ?? {}).note);
  }
}
