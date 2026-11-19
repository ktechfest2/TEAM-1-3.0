import { Module } from '@nestjs/common';
import { ElectionsModule } from '../elections/elections.module.js';
import { ResultsStreamService } from './results-stream.service.js';
import { TallyController } from './tally.controller.js';
import { TallyService } from './tally.service.js';

@Module({
  imports: [ElectionsModule],
  controllers: [TallyController],
  providers: [TallyService, ResultsStreamService],
  exports: [TallyService],
})
export class TallyModule {}
