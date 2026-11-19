'use client';

import { AuthImage } from '@/components/admin/auth-image';
import { cardClass } from '@/components/admin/page-shell';
import { useAdmin, useAdminApi } from '@/lib/admin-session';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { DecisionButtons } from './decision-buttons';
import { RecordForm } from './record-form';

type Declaration = {
  id: string;
  electionTitle: string;
  level: string;
  areaCode: string | null;
  areaName: string;
  figures: { partyVotes: Record<string, number>; totalValid: number };
  declaredAt: string;
  sourceKind: string;
  sourceUrl: string | null;
  hasSourceImage: boolean;
  status: 'pending' | 'approved' | 'rejected';
  enteredById: string;
  enteredBy: string;
  approvedBy: string | null;
  rejectionReason: string | null;
};

type ElectionSummary = { id: string; title: string; status: string };
type ElectionDetail = { id: string; title: string; scopeLevel: string; scopeCode: string | null; parties: { acronym: string; name: string }[] };

const SOURCE: Record<string, string> = {
  collation_result_photo: 'Collation sheet photo',
  inec_statement: 'INEC statement',
  broadcast: 'Broadcast',
};
const STATUS_CLASS = { pending: 'bg-pending-bg text-pending', approved: 'bg-match-bg text-match', rejected: 'bg-mismatch-bg text-mismatch' };
const LEVEL: Record<string, string> = { national: 'National', state: 'State', lga: 'LGA', ward: 'Ward' };

function when(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

export function Declarations() {
  const admin = useAdmin();
  const canRecord = admin.role === 'declarations_admin' || admin.role === 'system_admin';
  const canApprove = admin.role === 'approver' || admin.role === 'system_admin';
  const q = useAdminApi<Declaration[]>('/admin/declarations');
  const e = useAdminApi<ElectionSummary[]>(canRecord ? '/admin/elections' : null);
  const [details, setDetails] = useState<ElectionDetail[]>([]);
  const ids = e.status === 'ready' ? e.data.filter((x) => x.status !== 'draft').map((x) => x.id).join(',') : '';
  useEffect(() => {
    if (!ids) return;
    let live = true;
    Promise.all(ids.split(',').map((id) => apiGet<ElectionDetail>(`/admin/elections/${id}`, 'admin'))).then(
      (d) => live && setDetails(d),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ids]);
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  const list = q.data;
  const elections = ids ? details : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_26rem] lg:items-start">
      <section aria-labelledby="list-heading" className={cardClass}>
        <h2 id="list-heading" className="border-b border-divider px-5 py-4 text-lg font-semibold">
          Declarations <span className="text-ink-muted tabular">({list.length})</span>
        </h2>
        {list.length === 0 ? (
          <p className="px-5 py-6 text-ink-muted">No declarations recorded yet.</p>
        ) : (
          <ul>
            {list.map((d) => (
              <li key={d.id} className="grid gap-3 border-t border-divider px-5 py-4 first:border-t-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {LEVEL[d.level]}: {d.areaName} {d.areaCode && <span className="font-mono text-sm text-ink-muted">{d.areaCode}</span>}
                      </h3>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_CLASS[d.status]}`}>{d.status}</span>
                    </div>
                    <p className="text-sm text-ink-muted">
                      {d.electionTitle} · declared {when(d.declaredAt)} · {SOURCE[d.sourceKind]} · entered by {d.enteredBy}
                      {d.approvedBy ? ` · ${d.status === 'approved' ? 'approved' : 'rejected'} by ${d.approvedBy}` : ''}
                    </p>
                  </div>
                  {canApprove && d.status === 'pending' && d.enteredById !== admin.id && <DecisionButtons id={d.id} />}
                  {d.status === 'pending' && d.enteredById === admin.id && (
                    <p className="text-sm text-ink-muted">Waiting for a second administrator</p>
                  )}
                </div>
                <p className="text-sm tabular">
                  {Object.entries(d.figures.partyVotes).map(([p, v]) => `${p} ${v.toLocaleString('en-NG')}`).join(' · ')} · Total valid{' '}
                  {d.figures.totalValid.toLocaleString('en-NG')}
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {d.sourceUrl && (
                    <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-strong hover:underline">
                      Source link
                    </a>
                  )}
                  {d.hasSourceImage && (
                    <details>
                      <summary className="cursor-pointer font-medium text-brand-strong hover:underline">Source photo</summary>
                      <AuthImage path={`/admin/declarations/${d.id}/source`} alt="Source document" className="mt-2 max-h-96 w-auto rounded-lg border border-divider" />
                    </details>
                  )}
                </div>
                {d.rejectionReason && <p className="text-sm text-mismatch">Rejected: {d.rejectionReason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canRecord ? (
        <section className={`${cardClass} p-5`}>
          <RecordForm elections={elections} />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">Declarations administrators record declarations; approvers check and approve them.</p>
      )}
    </div>
  );
}
