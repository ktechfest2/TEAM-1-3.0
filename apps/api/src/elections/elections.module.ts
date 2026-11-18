import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminElectionsController, PublicElectionsController } from './elections.controller.js';
import { ElectionsService } from './elections.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PublicElectionsController, AdminElectionsController],
  providers: [ElectionsService],
  exports: [ElectionsService],
})
export class ElectionsModule {}
