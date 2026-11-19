import { Module } from '@nestjs/common';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { TallyModule } from '../tally/tally.module.js';
import { ChainController, EvidenceController } from './evidence.controller.js';
import { EvidencePackService } from './evidence-pack.service.js';

@Module({
  imports: [TallyModule],
  controllers: [ChainController, EvidenceController],
  providers: [EvidencePackService, EvidenceStorage],
})
export class EvidenceModule {}
