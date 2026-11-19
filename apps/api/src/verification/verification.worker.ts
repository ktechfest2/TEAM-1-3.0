import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { VerificationService } from './verification.service.js';

const POLL_MS = 3_000;
/** Photos verified at the same time per API instance */
const CONCURRENCY = 2;

/** Background loop that verifies pending photos as they arrive. */
@Injectable()
export class VerificationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('VerificationWorker');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly verification: VerificationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('VERIFICATION_WORKER', { infer: true }) !== 'on') return;
    if (!this.config.get('OPENROUTER_API_KEY', { infer: true })) {
      this.logger.warn('OPENROUTER_API_KEY is not set; photos will stay pending until it is.');
      return;
    }
    this.logger.log(`verifying photos with ${this.config.get('OPENROUTER_MODEL', { infer: true })}`);
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const ids = await this.verification.claim(CONCURRENCY);
      await Promise.all(
        ids.map((id) =>
          this.verification.process(id).catch((err: Error) => this.logger.error(`submission ${id}: ${err.message}`)),
        ),
      );
    } catch (err) {
      this.logger.error(`worker error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
