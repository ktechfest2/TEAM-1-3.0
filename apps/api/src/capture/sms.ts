import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/** Sends SMS messages. The production gateway (Sprint 10) implements the same interface. */
export abstract class SmsSender {
  abstract send(to: string, text: string): Promise<void>;
}

/**
 * Development sender: writes the message to the API log instead of sending it.
 * Refuses to run in production, so codes are never silently dropped there.
 */
@Injectable()
export class LogSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS (development)');

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async send(to: string, text: string): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new ServiceUnavailableException('SMS is not configured');
    }
    this.logger.log(`to ${to.slice(0, 7)}…${to.slice(-3)}: ${text.replace(/\n/g, ' | ')}`);
  }
}
