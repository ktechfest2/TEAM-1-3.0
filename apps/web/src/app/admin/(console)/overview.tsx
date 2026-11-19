'use client';

import Link from 'next/link';
import { ROLE_LABELS, useAdmin } from '@/lib/admin-session';

/** Sections of the console, delivered sprint by sprint (see the roadmap). */
const SECTIONS: { title: string; body: string; href?: string; sprint?: string }[] = [
  { title: 'Elections', body: 'Set up elections, their area and the parties on the ballot.', href: '/admin/elections' },
  { title: 'Parties', body: 'Registered parties available for elections.', href: '/admin/parties' },
  { title: 'Polling units', body: 'The INEC polling unit register by state, LGA and ward.', href: '/admin/register' },
  { title: 'Review queue', body: 'Resolve provisional and disputed polling units, with the photos behind each version.', href: '/admin/review' },
  { title: 'Live results dashboard', body: 'Real-time citizen-collated counts, coverage and confidence by area.', href: '/results/elections' },
  { title: 'Declared results', body: 'Record official declarations with their source; a second administrator approves.', href: '/admin/declarations' },
  { title: 'Abuse', body: 'One person posing as several witnesses, fakes and out-of-area captures; block numbers.', href: '/admin/abuse' },
  { title: 'Incident reports', body: 'Serious and sensitive reports held for review, with their evidence and the AI assessment.', href: '/admin/incidents' },
  { title: 'Assistant knowledge', body: 'The official facts the WhatsApp assistant may use; two-person approval.', href: '/admin/knowledge' },
  { title: 'Evidence and audit', body: 'Hash chain, published anchors and the public check of evidence packs.', href: '/verify' },
];

export function Overview() {
  const admin = useAdmin();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="text-sm font-semibold text-brand-strong">{ROLE_LABELS[admin.role]}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome, {admin.displayName}</h1>
      <p className="mt-1 text-ink-muted">{admin.email}</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <li key={s.title} className="relative rounded-2xl border border-divider bg-surface p-5 has-[a:hover]:border-brand">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">
                {s.href ? (
                  <Link href={s.href} className="after:absolute after:inset-0 hover:text-brand-strong">
                    {s.title}
                  </Link>
                ) : (
                  s.title
                )}
              </h2>
              {s.sprint && (
                <span className="shrink-0 rounded-full bg-pending-bg px-2.5 py-0.5 text-xs font-semibold text-pending">
                  {s.sprint}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
