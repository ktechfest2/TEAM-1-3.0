import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuditService, SessionGuard],
  exports: [AuthService, AuditService, SessionGuard],
})
export class AuthModule {}
