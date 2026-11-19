import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { Subject } from 'rxjs';
import type { Env } from '../config/env.js';
import { TallyService } from './tally.service.js';

/** Postgres channel announcing that a unit result of an election changed (payload: election id). */
export const RESULTS_CHANNEL = 'trustelect_results';

/** At most one update per election per interval, however many units change. */
const THROTTLE_MS = 2_000;

/**
 * Turns database notifications into live updates for open dashboards (CNT-07).
 * Uses LISTEN/NOTIFY, so it works with several API instances behind a load balancer.
 */
@Injectable()
export class ResultsStreamService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ResultsStream');
  private readonly updates = new Subject<string>();
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private client: pg.Client | null = null;
  private stopped = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly tally: TallyService,
  ) {}

  /** Election ids whose results changed. */
  get changes() {
    return this.updates.asObservable();
  }

  async onApplicationBootstrap() {
    await this.connect();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    for (const t of this.pendingTimers.values()) clearTimeout(t);
    await this.client?.end().catch(() => undefined);
    this.updates.complete();
  }

  private async connect() {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.config.get('DATABASE_URL', { infer: true }) });
    client.on('notification', (msg) => {
      if (msg.channel === RESULTS_CHANNEL && msg.payload) this.changed(msg.payload);
    });
    client.on('error', (err) => {
      this.logger.warn(`listener lost (${err.message}); reconnecting`);
      this.client = null;
      setTimeout(() => void this.connect(), 2_000);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${RESULTS_CHANNEL}`);
      this.client = client;
    } catch (err) {
      this.logger.warn(`could not listen (${(err as Error).message}); retrying`);
      setTimeout(() => void this.connect(), 5_000);
    }
  }

  private changed(electionId: string) {
    this.tally.invalidate(electionId);
    if (this.pendingTimers.has(electionId)) return;
    this.pendingTimers.set(
      electionId,
      setTimeout(() => {
        this.pendingTimers.delete(electionId);
        this.tally.invalidate(electionId);
        this.updates.next(electionId);
      }, THROTTLE_MS),
    );
  }
}
