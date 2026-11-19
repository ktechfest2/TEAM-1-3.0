import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { ChainModule } from './chain/chain.module.js';
import { EvidenceModule } from './chain/evidence.module.js';
import { CaptureModule } from './capture/capture.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DeclarationsModule } from './declarations/declarations.module.js';
import { ElectionsModule } from './elections/elections.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { HealthController } from './health/health.controller.js';
import { ResultsModule } from './results/results.module.js';
import { SecurityModule } from './security/security.module.js';
import { TallyModule } from './tally/tally.module.js';
import { ChannelsModule } from './channels/channels.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';

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
    ChainModule,
    AuthModule,
    GeographyModule,
    ElectionsModule,
    CaptureModule,
    ResultsModule,
    TallyModule,
    DeclarationsModule,
    EvidenceModule,
    KnowledgeModule,
    WhatsAppModule,
    ChannelsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
