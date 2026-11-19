import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'Live results' };

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

type Election = { id: string; title: string; electionDate: string; status: 'active' | 'closed' };

async function Elections() {
  let list: Election[] = [];
  try {
    const res = await fetch(`${API_URL}/results/elections`, { cache: 'no-store' });
    if (res.ok) list = (await res.json()) as Election[];
  } catch {
    return <p className="text-mismatch">Elections could not be loaded right now. Please try again shortly.</p>;
  }
  if (list.length === 0) return <p className="text-ink-muted">No elections have been published yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {list.map((e) => (
        <li key={e.id}>
          <Link
            href={`/results/elections/${e.id}`}
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

export default function ElectionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Live results</h1>
      <p className="mt-2 max-w-[60ch] text-ink-muted">
        Citizen-collated totals, added up from verified polling unit photos. Each total shows how many polling units it
        covers.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p role="status" className="text-ink-muted">Loading…</p>}>
          <Elections />
        </Suspense>
      </div>
    </div>
  );
}
