import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CaptureModule } from '../capture/capture.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import type { Env } from '../config/env.js';
import { Assistant, OpenRouterAssistant } from './assistant.js';
import { CloudWhatsAppClient, LogWhatsAppClient, WhatsAppClient } from './client.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  imports: [CaptureModule, KnowledgeModule, MessagingModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    {
      provide: WhatsAppClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('WHATSAPP_PROVIDER', { infer: true }) === 'cloud' ? new CloudWhatsAppClient(config) : new LogWhatsAppClient(),
    },
    { provide: Assistant, inject: [ConfigService], useFactory: (config: ConfigService<Env, true>) => new OpenRouterAssistant(config) },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
