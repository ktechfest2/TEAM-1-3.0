import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Get, Header, Param, Query, Sse, type MessageEvent } from '@nestjs/common';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { z } from 'zod';
import { parseOrThrow } from '../common/validation.js';
import { ElectionsService } from '../elections/elections.service.js';
import { ResultsStreamService } from './results-stream.service.js';
import { TallyService } from './tally.service.js';

const querySchema = z.object({
  level: z.enum(['national', 'state', 'lga', 'ward']).optional(),
  code: z.string().max(12).optional(),
});

/** Public, live citizen-collated totals for an election. */
@Controller('results/elections')
export class TallyController {
  constructor(
    private readonly tally: TallyService,
    private readonly stream: ResultsStreamService,
    private readonly elections: ElectionsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  list() {
    return this.elections.listElections({ includeDrafts: false });
  }

  /** Totals for the election's area, or a smaller area within it, with its children. */
  @Get(':id')
  @Header('Cache-Control', 'public, max-age=5')
  area(@Param('id') id: string, @Query() query: unknown) {
    parseOrThrow(z.uuid(), id);
    const q = parseOrThrow(querySchema, query);
    return this.tally.area(id, q.level, q.code);
  }

  /** Server-Sent Events: "update" whenever this election's results change; a comment every 25 s keeps it open. */
  // One long-lived connection per viewer
  @SkipThrottle()
  @Sse(':id/stream')
  live(@Param('id') id: string): Observable<MessageEvent> {
    parseOrThrow(z.uuid(), id);
    return merge(
      this.stream.changes.pipe(
        filter((electionId) => electionId === id),
        map((): MessageEvent => ({ type: 'update', data: { electionId: id, at: new Date().toISOString() } })),
      ),
      interval(25_000).pipe(map((): MessageEvent => ({ comment: 'keep-alive' }))),
    );
  }
}
