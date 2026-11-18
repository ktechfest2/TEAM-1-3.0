import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { createElectionSchema, createPartySchema, ElectionsService } from './elections.service.js';

/** Public: elections that are active or closed (drafts are hidden). */
@Controller('elections')
export class PublicElectionsController {
  constructor(private readonly elections: ElectionsService) {}

  @Get()
  list() {
    return this.elections.listElections({ includeDrafts: false });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.elections.getElection(id, { includeDrafts: false });
  }
}

/** Admin: parties and elections. Any signed-in admin can read; only system administrators change. */
@Controller('admin')
@UseGuards(SessionGuard)
export class AdminElectionsController {
  constructor(private readonly elections: ElectionsService) {}

  @Get('parties')
  parties() {
    return this.elections.listParties();
  }

  @Post('parties')
  @Roles('system_admin')
  createParty(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.elections.createParty(parseOrThrow(createPartySchema, body), admin.id);
  }

  @Get('elections')
  list() {
    return this.elections.listElections({ includeDrafts: true });
  }

  @Get('elections/:id')
  get(@Param('id') id: string) {
    return this.elections.getElection(id, { includeDrafts: true });
  }

  @Post('elections')
  @Roles('system_admin')
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.elections.createElection(parseOrThrow(createElectionSchema, body), admin.id);
  }

  @Post('elections/:id/status')
  @HttpCode(200)
  @Roles('system_admin')
  setStatus(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const { status } = parseOrThrow(z.object({ status: z.enum(['active', 'closed']) }), body);
    return this.elections.setStatus(id, status, admin.id);
  }
}
