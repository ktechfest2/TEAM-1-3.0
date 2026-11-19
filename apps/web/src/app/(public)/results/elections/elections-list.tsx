'use client';

import Link from 'next/link';
import { useApi } from '@/lib/api';

type Election = { id: string; title: string; electionDate: string; status: 'active' | 'closed' };

export function Elections() {
  const q = useApi<Election[]>('/results/elections');
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">Elections could not be loaded right now. Please try again shortly.</p>;
  const list = q.data;
  if (list.length === 0) return <p className="text-ink-muted">No elections have been published yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {list.map((e) => (
        <li key={e.id}>
          <Link
            href={`/results/election?id=${e.id}`}
            className="grid gap-1 rounded-2xl border border-divider bg-surface p-5 hover:border-brand"
          >
            <span className="font-semibold">{e.title}</span>
            <span className="text-sm text-ink-muted">
              {new Date(`${e.electionDate}T12:00:00+01:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}
              {e.status === 'active' ? 'Live' : 'Closed'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
