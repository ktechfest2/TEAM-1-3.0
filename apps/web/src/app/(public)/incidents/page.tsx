import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { IncidentList } from './incident-list';

export const metadata: Metadata = { title: 'Incident reports' };

export default function IncidentsPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-10 sm:px-6">
      <div className="grid gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Incident reports</h1>
        <p className="max-w-[65ch] text-ink-muted">
          Reports from voters, each with a photo taken at the polling unit. Every report is labelled by how far its evidence supports
          it, never &ldquo;true&rdquo; or &ldquo;fake&rdquo;. Serious reports (violence, ballot snatching, vote buying) are checked by a person
          before they appear here. Who sent a report is never shown.
        </p>
        <p>
          <Link href="/capture/report" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong">
            Report an incident
          </Link>
        </p>
      </div>
      <Suspense fallback={<p role="status" className="text-ink-muted">Loading…</p>}>
        <IncidentList />
      </Suspense>
    </div>
  );
}
