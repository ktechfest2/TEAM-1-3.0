'use client';

import Link from 'next/link';
import { UnitStatusBadge } from '@/components/status-badge';
import { cardClass } from '@/components/admin/page-shell';
import { useAdminApi } from '@/lib/admin-session';
import { FLAG_LABELS } from './flags';

type QueueItem = {
  electionId: string;
  electionTitle: string;
  unitCode: string;
  unitName: string;
  status: 'counted' | 'provisional' | 'disputed' | 'resolved' | 'not_confirmed';
  flags: string[];
  versionCount: number;
  witnessCount: number;
  updatedAt: string;
};


export function Queue() {
  const q = useAdminApi<QueueItem[]>('/admin/review/queue');
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  const items = q.data;
  if (items.length === 0) {
    return <p className={`${cardClass} px-5 py-6 text-ink-muted`}>Nothing to review. Disputed and provisional units will appear here.</p>;
  }
  return (
    <ul className={cardClass}>
      {items.map((u) => (
        <li key={`${u.electionId}-${u.unitCode}`} className="border-t border-divider first:border-t-0">
          <Link
            href={`/admin/review/unit?election=${u.electionId}&code=${u.unitCode}`}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface-muted"
          >
            <div className="grid gap-0.5">
              <p className="font-semibold">
                <span className="font-mono tabular">{u.unitCode}</span> {u.unitName}
              </p>
              <p className="text-sm text-ink-muted">
                {u.electionTitle} · {u.versionCount} versions · {u.witnessCount} witnesses behind the counted version
              </p>
              {u.flags.length > 0 && (
                <p className="text-sm text-dispute">{u.flags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}</p>
              )}
            </div>
            <UnitStatusBadge status={u.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
