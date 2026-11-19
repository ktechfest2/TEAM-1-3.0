import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/** Sends SMS replies on the two-way channel (from the short code). */
export abstract class TwoWaySms {
  abstract send(to: string, message: string): Promise<boolean>;
}

/** Development and tests: replies are kept in memory and logged (numbers masked). */
@Injectable()
export class LogTwoWaySms extends TwoWaySms {
  private readonly logger = new Logger('SMS');
  readonly sent: { to: string; message: string }[] = [];
  async send(to: string, message: string) {
    this.sent.push({ to, message });
    if (process.env.NODE_ENV !== 'test') this.logger.log(`to …${to.slice(-3)}: ${message}`);
    return true;
  }
}

/** Africa's Talking SMS API (sandbox when the username is "sandbox"). */
@Injectable()
export class AfricasTalkingSms extends TwoWaySms {
  private readonly logger = new Logger('AfricasTalking');

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly http: typeof fetch = fetch,
  ) {
    super();
  }

  async send(to: string, message: string) {
    const username = this.config.get('AFRICASTALKING_USERNAME', { infer: true });
    const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const body = new URLSearchParams({ username, to, message: message.slice(0, 918) });
    const from = this.config.get('AFRICASTALKING_SHORTCODE', { infer: true });
    if (from) body.set('from', from);
    try {
      const res = await this.http(`${host}/version1/messaging`, {
        method: 'POST',
        headers: { apiKey: this.config.get('AFRICASTALKING_API_KEY', { infer: true }) ?? '', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: { status?: string }[] } };
      const ok = res.ok && data.SMSMessageData?.Recipients?.[0]?.status === 'Success';
      if (!ok) this.logger.warn(`send failed: HTTP ${res.status} ${data.SMSMessageData?.Recipients?.[0]?.status ?? ''}`);
      return ok;
    } catch (err) {
      this.logger.warn(`send failed: ${(err as Error).message}`);
      return false;
    }
  }
}
