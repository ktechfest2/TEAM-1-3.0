import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { ChainService } from '../chain/chain.service.js';
import type { Executor } from '../chain/records.js';
import type { Database } from '../database/database.module.js';
import { auditLog } from '../database/schema.js';

export interface AuditEntry {
  adminUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

/** Records every administrative action (ADM-06). Entries are never updated or deleted. */
@Injectable()
export class AuditService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly chain: ChainService,
  ) {}

  /** Pass the open transaction when called inside one, so the chain lock is taken in order. */
  async record(entry: AuditEntry, exec: Executor = this.db): Promise<void> {
    const [row] = await exec.insert(auditLog).values({
      adminUserId: entry.adminUserId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      details: entry.details ?? null,
    }).returning();
    // ADM-06: written to the hash chain
    await this.chain.recordAudit(row, exec);
  }
}
