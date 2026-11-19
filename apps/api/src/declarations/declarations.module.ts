import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { raw } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import type { Env } from '../config/env.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { OpenRouterVisionModel, VisionModel } from '../verification/vision-model.js';
import { DeclarationsController } from './declarations.controller.js';
import { DeclarationsService } from './declarations.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DeclarationsController],
  providers: [
    DeclarationsService,
    EvidenceStorage,
    { provide: VisionModel, inject: [ConfigService], useFactory: (config: ConfigService<Env, true>) => new OpenRouterVisionModel(config) },
  ],
  exports: [DeclarationsService],
})
export class DeclarationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(raw({ type: ['image/jpeg', 'image/webp'], limit: 10 * 1024 * 1024 + 1024 }))
      .forRoutes({ path: 'admin/declarations/source', method: RequestMethod.POST });
  }
}
