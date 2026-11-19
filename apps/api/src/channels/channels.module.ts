import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { ChannelsController } from './channels.controller.js';
import { Contacts } from './contacts.js';
import { AfricasTalkingSms, LogTwoWaySms, TwoWaySms } from './sms-client.js';
import { SmsService } from './sms.service.js';
import { UssdService } from './ussd.service.js';

@Module({
  imports: [MessagingModule],
  controllers: [ChannelsController],
  providers: [
    Contacts,
    SmsService,
    UssdService,
    {
      provide: TwoWaySms,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('CHANNELS_PROVIDER', { infer: true }) === 'africastalking' ? new AfricasTalkingSms(config) : new LogTwoWaySms(),
    },
  ],
})
export class ChannelsModule {}
