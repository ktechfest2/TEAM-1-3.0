import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WitnessService } from './witness.service.js';

@Module({
  imports: [AuthModule],
  providers: [WitnessService],
  exports: [WitnessService],
})
export class WitnessModule {}
