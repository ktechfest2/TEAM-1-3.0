import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { Encryptor } from './encryption.js';

/** Provides the at-rest encryptor to the whole app. */
@Global()
@Module({
  providers: [
    {
      provide: Encryptor,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Encryptor(config.get('APP_ENCRYPTION_KEY', { infer: true })),
    },
  ],
  exports: [Encryptor],
})
export class SecurityModule {}
