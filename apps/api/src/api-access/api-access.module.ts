import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminApiClientsController, DevelopersController } from './api-access.controller.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysService } from './api-keys.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DevelopersController, AdminApiClientsController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiAccessModule {}
