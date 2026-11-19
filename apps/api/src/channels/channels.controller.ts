import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { parseOrThrow } from '../common/validation.js';
import { SmsService } from './sms.service.js';
import { UssdService } from './ussd.service.js';

/**
 * Africa's Talking callbacks for two-way SMS and USSD. Africa's Talking does not sign its
 * callbacks, so each address carries a long secret token; anything else is "not found".
 */
@Controller('channels/:token')
export class ChannelsController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly sms: SmsService,
    private readonly ussd: UssdService,
  ) {}

  private checkToken(token: string) {
    const expected = this.config.get('CHANNELS_WEBHOOK_TOKEN', { infer: true });
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected ?? '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException();
  }

  /** Africa's Talking checks a callback address before saving it: answer OK when the secret is right */
  @Get(['sms', 'ussd'])
  @Header('Content-Type', 'text/plain; charset=utf-8')
  check(@Param('token') token: string) {
    this.checkToken(token);
    return 'OK';
  }

  /** Incoming SMS: from, to, text, id, date, linkId */
  @Post('sms')
  @HttpCode(200)
  async incomingSms(@Param('token') token: string, @Body() body: unknown) {
    this.checkToken(token);
    const m = parseOrThrow(z.object({ from: z.string().min(5).max(20), text: z.string().max(1000).default(''), id: z.string().min(1).max(100) }), body);
    await this.sms.receive(m);
    return 'OK';
  }

  /** USSD session step: sessionId, serviceCode, phoneNumber, text ("1*240501003*…") */
  @Post('ussd')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async ussdStep(@Param('token') token: string, @Body() body: unknown) {
    this.checkToken(token);
    const s = parseOrThrow(
      z.object({ sessionId: z.string().min(1).max(100), phoneNumber: z.string().min(5).max(20), text: z.string().max(300).default('') }),
      body,
    );
    return this.ussd.handle(s.sessionId, `+${s.phoneNumber.replace(/\D/g, '')}`, s.text);
  }
}
