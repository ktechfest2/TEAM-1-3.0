import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignOutButton } from '@/components/admin/sign-out-button';
import { requireAdmin, ROLE_LABELS } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Console' };

/** Sections of the console, delivered sprint by sprint (see the roadmap). */
const SECTIONS = [
  { title: 'Elections and polling units', body: 'Set up elections and import the INEC polling unit register.', sprint: 'Sprint 2' },
  { title: 'Review queue', body: 'Resolve provisional and disputed polling units and serious incident reports.', sprint: 'Sprint 5' },
  { title: 'Live results dashboard', body: 'Real-time citizen-collated counts, coverage and confidence by area.', sprint: 'Sprint 6' },
  { title: 'Declared results', body: 'Record official declarations with their source; a second administrator approves.', sprint: 'Sprint 7' },
  { title: 'Evidence and audit', body: 'Hash chain, evidence packs and the audit log of every administrative action.', sprint: 'Sprint 8' },
];

async function Console() {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-strong">{ROLE_LABELS[admin.role]}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome, {admin.displayName}</h1>
          <p className="mt-1 text-ink-muted">{admin.email}</p>
        </div>
        <SignOutButton />
      </div>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <li key={s.title} className="rounded-2xl border border-divider bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">{s.title}</h2>
              <span className="shrink-0 rounded-full bg-pending-bg px-2.5 py-0.5 text-xs font-semibold text-pending">
                {s.sprint}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminHomePage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="mx-auto max-w-6xl px-4 py-10 text-ink-muted sm:px-6">
          Checking your session…
        </p>
      }
    >
      <Console />
    </Suspense>
  );
}
