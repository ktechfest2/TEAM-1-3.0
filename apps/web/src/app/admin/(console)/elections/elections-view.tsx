'use client';

import { NIGERIAN_STATES } from '@trustelect/shared';
import { cardClass } from '@/components/admin/page-shell';
import { useAdmin, useAdminApi } from '@/lib/admin-session';
import { CreateElectionForm } from './create-election-form';
import { ELECTION_TYPE_LABELS, STATUS_LABELS, type ElectionStatus, type ElectionSummary } from './labels';
import { StatusButton } from './status-button';

const STATUS_CLASSES: Record<ElectionStatus, string> = {
  draft: 'bg-pending-bg text-pending',
  active: 'bg-match-bg text-match',
  closed: 'bg-surface-muted text-ink-muted',
};

function area(e: ElectionSummary) {
  if (e.scopeLevel === 'national') return 'Whole country';
  if (e.scopeLevel === 'state') return NIGERIAN_STATES.find((s) => s.code === e.scopeCode)?.name ?? `State ${e.scopeCode}`;
  return `LGA ${e.scopeCode}`;
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00+01:00`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

export function Elections() {
  const admin = useAdmin();
  const q = useAdminApi<ElectionSummary[]>('/admin/elections');
  const p = useAdminApi<{ acronym: string; name: string }[]>('/admin/parties');
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  if (p.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (p.status === 'error') return <p className="text-mismatch">{p.error.message}</p>;
  const elections = q.data;
  const parties = p.data;
  const canEdit = admin.role === 'system_admin';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem] lg:items-start">
      <section aria-labelledby="election-list-heading" className={cardClass}>
        <h2 id="election-list-heading" className="border-b border-divider px-5 py-4 text-lg font-semibold">
          Elections <span className="text-ink-muted tabular">({elections.length})</span>
        </h2>
        {elections.length === 0 ? (
          <p className="px-5 py-6 text-ink-muted">No elections yet.</p>
        ) : (
          <ul>
            {elections.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-4 border-t border-divider px-5 py-4 first:border-t-0">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{e.title}</h3>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[e.status]}`}>
                      {STATUS_LABELS[e.status]}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {ELECTION_TYPE_LABELS[e.type]} · {area(e)} · {formatDate(e.electionDate)}, polls close{' '}
                    {formatTime(e.pollsCloseAt)} · <span className="tabular">{e.parties}</span> parties
                  </p>
                </div>
                {canEdit && <StatusButton id={e.id} status={e.status} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit ? (
        <section className={`${cardClass} p-5`}>
          <CreateElectionForm parties={parties} />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">Only system administrators can create or change elections.</p>
      )}
    </div>
  );
}
