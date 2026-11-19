import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { raw } from 'express';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { VerificationModule } from '../verification/verification.module.js';
import { CaptureController, CaptureSessionGuard } from './capture.controller.js';
import { CaptureService, MAX_PHOTO_BYTES } from './capture.service.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { BulkSmsLiveSender } from './bulksmslive.js';
import { LogSmsSender, SmsSender } from './sms.js';

@Module({
  imports: [VerificationModule],
  controllers: [CaptureController],
  providers: [
    CaptureService,
    CaptureSessionGuard,
    EvidenceStorage,
    {
      provide: SmsSender,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('SMS_PROVIDER', { infer: true }) === 'bulksmslive'
          ? new BulkSmsLiveSender(config)
          : new LogSmsSender(config),
    },
  ],
  exports: [CaptureService],
})
export class CaptureModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Photos arrive as raw image bytes; only this route accepts them
    consumer
      .apply(raw({ type: ['image/jpeg', 'image/webp'], limit: MAX_PHOTO_BYTES + 1024 }))
      .forRoutes({ path: 'capture/photos', method: RequestMethod.POST });
  }
}
