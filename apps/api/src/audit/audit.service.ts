import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
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
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({
      adminUserId: entry.adminUserId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      details: entry.details ?? null,
    });
  }
}
