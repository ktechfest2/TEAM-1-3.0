import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { WitnessModule } from '../witnesses/witness.module.js';
import { VerificationService } from './verification.service.js';
import { VerificationWorker } from './verification.worker.js';
import { OpenRouterVisionModel, VisionModel } from './vision-model.js';

@Module({
  imports: [WitnessModule],
  providers: [
    VerificationService,
    VerificationWorker,
    EvidenceStorage,
    {
      provide: VisionModel,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => new OpenRouterVisionModel(config),
    },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
