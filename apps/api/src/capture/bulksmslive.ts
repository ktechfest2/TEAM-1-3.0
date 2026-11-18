import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { SmsSender } from './sms.js';

/**
 * BulkSMSLive HTTP SMS API v2, API-key method:
 *   POST https://api.bulksmslive.com/v2/app/sendsms
 *   Authorization: Bearer {apikey}, Accept: application/json
 *   message, sender_name (max 11 chars), recipients (234…, comma-separated), forcednd
 * Response: status 1 = sent (with msgid, units, balance); negative codes are errors.
 */
export const BULKSMSLIVE_URL = 'https://api.bulksmslive.com/v2/app/sendsms';

const STATUS_MESSAGES: Record<string, string> = {
  '-2': 'invalid parameter',
  '-3': 'account suspended',
  '-4': 'invalid sender name',
  '-5': 'invalid message content',
  '-6': 'invalid recipient',
  '-7': 'insufficient units',
  '-10': 'unknown error',
};

export interface BulkSmsLiveResponse {
  status?: number | string;
  msg?: string;
  msgid?: string;
  Msgid?: string;
  units?: number | string;
  balance?: number | string;
}

@Injectable()
export class BulkSmsLiveSender extends SmsSender {
  private readonly logger = new Logger('SMS (BulkSMSLive)');

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly http: typeof fetch = fetch,
  ) {
    super();
  }

  async send(to: string, text: string): Promise<void> {
    const apiKey = this.config.get('BULKSMSLIVE_API_KEY', { infer: true });
    if (!apiKey) throw new ServiceUnavailableException('SMS is not configured');

    const body = new URLSearchParams({
      message: text,
      sender_name: this.config.get('SMS_SENDER_NAME', { infer: true }),
      // BulkSMSLive expects 234XXXXXXXXXX without the plus sign
      recipients: to.replace(/^\+/, ''),
      // Delivers to MTN numbers on Do-Not-Disturb (charged 2 units)
      forcednd: '1',
    });

    let data: BulkSmsLiveResponse;
    try {
      const res = await this.http(BULKSMSLIVE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      data = (await res.json().catch(() => ({}))) as BulkSmsLiveResponse;
      if (res.status === 401) data = { status: 401, msg: 'unauthenticated (check the API key)' };
    } catch (err) {
      this.logger.error(`request failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not send the SMS. Try again shortly.');
    }

    if (String(data.status) !== '1') {
      const reason = STATUS_MESSAGES[String(data.status)] ?? data.msg ?? `status ${data.status}`;
      // Never log the message text: it contains the code
      this.logger.error(`send to ${to.slice(0, 7)}…${to.slice(-3)} failed: ${reason}`);
      throw new ServiceUnavailableException('Could not send the SMS. Try again shortly.');
    }
    this.logger.log(`sent to ${to.slice(0, 7)}…${to.slice(-3)} (id ${data.msgid ?? data.Msgid ?? '?'}, units ${data.units ?? '?'}, balance ${data.balance ?? '?'})`);
  }
}
