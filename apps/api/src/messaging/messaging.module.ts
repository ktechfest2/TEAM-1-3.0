import { Module } from '@nestjs/common';
import { CaptureModule } from '../capture/capture.module.js';
import { ResultsModule } from '../results/results.module.js';
import { TallyModule } from '../tally/tally.module.js';
import { WitnessModule } from '../witnesses/witness.module.js';
import { MessagingCore } from './core.service.js';

/** Shared by the WhatsApp, SMS and USSD channels */
@Module({
  imports: [CaptureModule, ResultsModule, TallyModule, WitnessModule],
  providers: [MessagingCore],
  exports: [MessagingCore],
})
export class MessagingModule {}
