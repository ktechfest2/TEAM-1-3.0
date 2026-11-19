import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { WitnessModule } from '../witnesses/witness.module.js';
import { AdminReviewController, PublicResultsController } from './results.controller.js';
import { ResultsService } from './results.service.js';

@Module({
  imports: [AuthModule, WitnessModule],
  controllers: [PublicResultsController, AdminReviewController],
  providers: [ResultsService, EvidenceStorage],
})
export class ResultsModule {}
