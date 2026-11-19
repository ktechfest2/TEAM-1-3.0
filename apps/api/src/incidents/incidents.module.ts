import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { raw } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import { CaptureModule } from '../capture/capture.module.js';
import type { Env } from '../config/env.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { IncidentAssessor, OpenRouterIncidentAssessor } from './assessor.js';
import { AdminIncidentsController, IncidentsController } from './incidents.controller.js';
import { IncidentsService, MAX_EVIDENCE_BYTES } from './incidents.service.js';

@Module({
  imports: [AuthModule, CaptureModule],
  controllers: [IncidentsController, AdminIncidentsController],
  providers: [
    IncidentsService,
    EvidenceStorage,
    { provide: IncidentAssessor, inject: [ConfigService], useFactory: (config: ConfigService<Env, true>) => new OpenRouterIncidentAssessor(config) },
  ],
  exports: [IncidentsService],
})
export class IncidentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(raw({ type: ['image/jpeg', 'image/webp'], limit: MAX_EVIDENCE_BYTES + 1024 }))
      .forRoutes({ path: 'incidents', method: RequestMethod.POST });
  }
}
