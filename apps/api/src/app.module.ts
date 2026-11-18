import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { ElectionsModule } from './elections/elections.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { HealthController } from './health/health.controller.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    SecurityModule,
    AuthModule,
    GeographyModule,
    ElectionsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
