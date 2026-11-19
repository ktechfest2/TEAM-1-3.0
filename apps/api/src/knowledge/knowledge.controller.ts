import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedAdmin } from '../auth/auth.service.js';
import { CurrentAdmin, Roles, SessionGuard } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import { knowledgeInputSchema, KnowledgeService } from './knowledge.service.js';

/** Knowledge base for the information assistant (ADM-04). */
@Controller('admin/knowledge')
@UseGuards(SessionGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list() {
    return this.knowledge.list();
  }

  @Post()
  @Roles('declarations_admin')
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.knowledge.create(parseOrThrow(knowledgeInputSchema, body), admin.id);
  }

  @Post(':id')
  @HttpCode(200)
  @Roles('declarations_admin')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    parseOrThrow(z.uuid(), id);
    return this.knowledge.update(id, parseOrThrow(knowledgeInputSchema, body), admin.id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('approver')
  approve(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    parseOrThrow(z.uuid(), id);
    return this.knowledge.approve(id, admin.id);
  }

  @Post(':id/retire')
  @HttpCode(200)
  @Roles('approver')
  retire(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    parseOrThrow(z.uuid(), id);
    return this.knowledge.retire(id, admin.id);
  }
}
