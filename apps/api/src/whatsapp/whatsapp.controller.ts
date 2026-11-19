import { Controller, ForbiddenException, Get, Header, HttpCode, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import { WhatsAppService, type Inbound } from './whatsapp.service.js';

type WebhookMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id: string }; list_reply?: { id: string } };
  button?: { payload?: string; text?: string };
  audio?: { id?: string };
  image?: { id?: string };
};
type WebhookBody = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: WebhookMessage[];
        statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
      };
    }[];
  }[];
};

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Meta WhatsApp Cloud API webhook. Every call must carry a valid X-Hub-Signature-256. */
@Controller('whatsapp/webhook')
export class WhatsAppController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Registration: Meta sends the verify token and expects the challenge back */
  @Get()
  @Header('Content-Type', 'text/plain')
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    const expected = this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true });
    if (mode !== 'subscribe' || !expected || !token || !safeEqual(token, expected) || !/^[\w-]{1,200}$/.test(challenge ?? '')) {
      throw new ForbiddenException();
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    const secret = this.config.get('WHATSAPP_APP_SECRET', { infer: true });
    const signature = req.headers['x-hub-signature-256'];
    if (!secret || !req.rawBody || typeof signature !== 'string') throw new ForbiddenException();
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    if (!safeEqual(signature, expected)) throw new ForbiddenException();

    const body = req.body as WebhookBody;
    const ourNumber = this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value || (ourNumber && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ourNumber)) continue;
        for (const s of value.statuses ?? []) await this.whatsapp.status(s.id, s.status, s.errors?.[0]?.title);
        for (const m of value.messages ?? []) await this.whatsapp.receive(toInbound(m));
      }
    }
    // Answer quickly; messages are handled in the background, in order
    return { status: 'ok' };
  }
}

function toInbound(m: WebhookMessage): Inbound {
  const base = { id: m.id, from: m.from };
  switch (m.type) {
    case 'text':
      return { ...base, type: 'text', text: m.text?.body ?? '' };
    case 'interactive':
      return { ...base, type: 'button', choice: m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id };
    case 'button':
      return { ...base, type: 'text', text: m.button?.text ?? m.button?.payload ?? '' };
    case 'image':
      return { ...base, type: 'media', mediaId: m.image?.id, mediaKind: 'image' };
    case 'video':
    case 'document':
    case 'sticker':
      return { ...base, type: 'media' };
    case 'audio':
      return { ...base, type: 'audio', mediaId: m.audio?.id };
    default:
      return { ...base, type: 'other' };
  }
}
