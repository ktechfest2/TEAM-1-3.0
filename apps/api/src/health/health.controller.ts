import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { count, eq, min } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { submissions } from '../database/schema.js';

/** A photo waiting longer than this means verification is falling behind */
export const BACKLOG_ALERT_MINUTES = 15;

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Liveness: the process is up. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness (Sprint 16): 503 when the database does not answer within 3 seconds.
   * Otherwise 200, with status "degraded" when photos are waiting too long for verification
   * or the AI key is missing: the API still serves results and accepts photos, which are
   * verified once the backlog clears (degraded mode, not an outage).
   */
  @Get('ready')
  async ready() {
    let backlog: { pending: number; oldest: Date | null };
    try {
      const query = this.db
        .select({ pending: count(), oldest: min(submissions.receivedAt) })
        .from(submissions)
        .where(eq(submissions.status, 'pending'));
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000).unref());
      [backlog] = await Promise.race([query, timeout]);
    } catch {
      throw new ServiceUnavailableException({ status: 'down', database: 'down' });
    }
    const oldestMinutes = backlog.oldest ? Math.floor((Date.now() - new Date(backlog.oldest).getTime()) / 60_000) : 0;
    const ai = Boolean(this.config.get('OPENROUTER_API_KEY', { infer: true }));
    const behind = oldestMinutes >= BACKLOG_ALERT_MINUTES;
    return {
      status: behind || !ai ? 'degraded' : 'ok',
      database: 'up',
      ai: ai ? 'configured' : 'missing',
      verification: { pending: backlog.pending, oldestMinutes, behind },
    };
  }
}
