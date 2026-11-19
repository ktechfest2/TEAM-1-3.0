import { Global, Module } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import { ChainService } from './chain.service.js';

/** The hash chain is written from every module that changes evidence, so it is global. */
@Global()
@Module({
  providers: [ChainService, AnchorService],
  exports: [ChainService, AnchorService],
})
export class ChainModule {}
