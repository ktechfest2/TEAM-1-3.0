import { Controller, Get, Header, NotFoundException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { anchorRecordText, parseUnitCode } from '@trustelect/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../common/validation.js';
import { AnchorService } from './anchor.service.js';
import { ChainService } from './chain.service.js';
import { EvidencePackService } from './evidence-pack.service.js';

/** Public view of the hash chain (EVD-03, EVD-05). Hashes only; never record contents. */
@Controller('chain')
export class ChainController {
  constructor(
    private readonly chain: ChainService,
    private readonly anchorService: AnchorService,
  ) {}

  @Get('head')
  @Header('Cache-Control', 'no-store')
  async head() {
    const [head, [anchor]] = await Promise.all([this.chain.head(), this.chain.anchors(1)]);
    return { head: head && { ...head, createdAt: head.createdAt.toISOString() }, latestAnchor: anchor ?? null };
  }

  @Get('entries')
  @Header('Cache-Control', 'no-store')
  entries(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({ from: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(5000).default(1000) }),
      query,
    );
    return this.chain.entries(q.from, q.limit);
  }

  @Get('anchors')
  @Header('Cache-Control', 'no-store')
  anchors(@Query() query: unknown) {
    const { limit } = parseOrThrow(z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }), query);
    return this.chain.anchors(limit);
  }

  /** The anchor record and its OpenTimestamps proof: `ots verify anchor-<seq>.txt.ots` */
  @Get('anchors/:id/:file')
  async anchorFile(@Param('id') id: string, @Param('file') file: string, @Res({ passthrough: true }) res: Response) {
    const anchor = await this.anchorService.proof(parseOrThrow(z.coerce.number().int().positive(), id));
    if (!anchor) throw new NotFoundException('Anchor not found');
    const text = anchorRecordText({ seq: anchor.seq, hash: anchor.hash, createdAt: anchor.createdAt.toISOString() });
    const name = `trustelect-anchor-${anchor.seq}.txt`;
    if (file === 'record.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return text;
    }
    if (file === 'record.txt.ots' && anchor.externalProof) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.ots"`);
      return new StreamableFile(Buffer.from(anchor.externalProof, 'base64'));
    }
    throw new NotFoundException('No such file for this anchor');
  }
}

/** Evidence packs per polling unit or ward (EVD-04). */
@Controller('evidence/elections/:electionId')
export class EvidenceController {
  constructor(private readonly packs: EvidencePackService) {}

  @Get('units/:code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  unit(@Param('electionId') electionId: string, @Param('code') code: string, @Res({ passthrough: true }) res: Response) {
    const unit = parseUnitCode(code);
    if (!unit) throw new NotFoundException('Polling unit not found');
    return this.send(electionId, 'polling_unit', unit.unit, res);
  }

  @Get('wards/:code')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  ward(@Param('electionId') electionId: string, @Param('code') code: string, @Res({ passthrough: true }) res: Response) {
    parseOrThrow(z.string().regex(/^\d{2}-\d{2}-\d{2}$/), code);
    return this.send(electionId, 'ward', code, res);
  }

  private async send(electionId: string, level: 'polling_unit' | 'ward', code: string, res: Response) {
    parseOrThrow(z.uuid(), electionId);
    const { zip, filename } = await this.packs.build(electionId, level, code);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(zip);
  }
}
