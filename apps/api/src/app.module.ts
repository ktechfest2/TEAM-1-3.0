import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CaptureModule } from './capture/capture.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { ElectionsModule } from './elections/elections.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { HealthController } from './health/health.controller.js';
import { ResultsModule } from './results/results.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      // Tests never read .env, so they cannot pick up real SMS or other live credentials
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    SecurityModule,
    AuthModule,
    GeographyModule,
    ElectionsModule,
    CaptureModule,
    ResultsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
