import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WitnessModule } from '../witnesses/witness.module.js';
import { FraudController } from './fraud.controller.js';
import { FraudService } from './fraud.service.js';

@Module({
  imports: [AuthModule, WitnessModule],
  controllers: [FraudController],
  providers: [FraudService],
})
export class FraudModule {}
