import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller.js';
import { GeographyService } from './geography.service.js';

@Module({
  controllers: [GeographyController],
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}
