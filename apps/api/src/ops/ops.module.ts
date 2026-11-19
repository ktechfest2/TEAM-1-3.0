import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TallyModule } from '../tally/tally.module.js';
import { OpsController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

@Module({
  imports: [AuthModule, TallyModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
