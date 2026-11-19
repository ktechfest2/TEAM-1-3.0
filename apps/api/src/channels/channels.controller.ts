import { SkipThrottle } from '@nestjs/throttler';
import { Body, Controller, Get, Header, HttpCode, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { SmsService } from './sms.service.js';
import { UssdService } from './ussd.service.js';

/**
 * Africa's Talking callbacks for two-way SMS and USSD. Africa's Talking does not sign its
 * callbacks, so each address carries a long secret token; anything else is "not found".
 */
/** Africa's Talking sends every USSD step; the secret address protects these */
@SkipThrottle()
@Controller('channels/:token')
export class ChannelsController {
  private readonly logger = new Logger('Channels');

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly sms: SmsService,
    private readonly ussd: UssdService,
  ) {}

  /** Logs what an incomplete request carried (field names only, never values) and answers 200 */
  private probe(req: Request, answer: string) {
    const fields = req.body && typeof req.body === 'object' ? Object.keys(req.body as object).join(',') : typeof req.body;
    this.logger.log(`address check: ${req.method} ${req.headers['content-type'] ?? '-'} fields=[${fields}] ua=${(req.headers['user-agent'] ?? '-').slice(0, 60)}`);
    return answer;
  }

  private checkToken(token: string) {
    const expected = this.config.get('CHANNELS_WEBHOOK_TOKEN', { infer: true });
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected ?? '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      // Diagnose misconfigured callback addresses; the secret itself is never logged
      this.logger.warn(`callback with a wrong secret (length ${token?.length ?? 0}, expected ${expected?.length ?? 0})`);
      throw new NotFoundException();
    }
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
  async incomingSms(@Param('token') token: string, @Body() body: unknown, @Req() req: Request) {
    this.checkToken(token);
    const parsed = z.object({ from: z.string().min(5).max(20), text: z.string().max(1000).default(''), id: z.string().min(1).max(100) }).safeParse(body);
    // The provider checks the address with a request that carries no message: answer OK
    if (!parsed.success) return this.probe(req, 'OK');
    const m = parsed.data;
    this.logger.log(`sms in (${m.text.length} chars)`);
    await this.sms.receive(m);
    return 'OK';
  }

  /** USSD session step: sessionId, serviceCode, phoneNumber, text ("1*240501003*…") */
  @Post('ussd')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async ussdStep(@Param('token') token: string, @Body() body: unknown, @Req() req: Request) {
    this.checkToken(token);
    const parsed = z
      .object({ sessionId: z.string().min(1).max(100), phoneNumber: z.string().min(5).max(20), text: z.string().max(300).default('') })
      .safeParse(body);
    if (!parsed.success) return this.probe(req, 'END TrustElect');
    const s = parsed.data;
    const reply = await this.ussd.handle(s.sessionId, `+${s.phoneNumber.replace(/\D/g, '')}`, s.text);
    // Session shape only (no number, no input): depth of the menu and the answer type
    this.logger.log(`ussd session …${s.sessionId.slice(-4)} step ${s.text === '' ? 0 : s.text.split('*').length} -> ${reply.slice(0, 3)} (${reply.length} chars)`);
    return reply;
  }
}
