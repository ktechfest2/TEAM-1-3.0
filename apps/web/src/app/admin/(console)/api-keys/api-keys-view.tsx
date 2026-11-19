'use client';

import { useState } from 'react';
import { cardClass } from '@/components/admin/page-shell';
import { adminPost } from '@/lib/admin-client';
import { useAdmin, useAdminApi, useAdminRefresh } from '@/lib/admin-session';

type Status = 'pending' | 'active' | 'revoked' | 'rejected';
type Client = {
  id: string;
  organisation: string;
  contactName: string;
  email: string;
  website: string | null;
  purpose: string;
  keyPrefix: string;
  status: Status;
  decidedAt: string | null;
  decisionNote: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
};

const when = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

const BADGE: Record<Status, string> = {
  pending: 'bg-dispute-bg text-dispute',
  active: 'bg-match-bg text-match',
  revoked: 'bg-mismatch-bg text-mismatch',
  rejected: 'bg-pending-bg text-pending',
};
const LABEL: Record<Status, string> = { pending: 'Waiting for approval', active: 'Active', revoked: 'Revoked', rejected: 'Rejected' };

function Decide({ client }: { client: Client }) {
  const refresh = useAdminRefresh();
  const [open, setOpen] = useState<'reject' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'approve' | 'reject' | 'revoke', note?: string) => {
    const r = await adminPost(`/admin/api-clients/${client.id}/${action}`, { note: note || null });
    if (!r.ok) return setError(r.message);
    setOpen(null);
    refresh();
  };
  const button = 'min-h-9 rounded-lg px-3 text-sm font-semibold';
  return (
    <div className="grid gap-2">
      {!open && (
        <div className="flex flex-wrap gap-2">
          {client.status === 'pending' && (
            <>
              <button type="button" onClick={() => act('approve')} className={`${button} bg-brand text-brand-ink hover:bg-brand-strong`}>Approve</button>
              <button type="button" onClick={() => setOpen('reject')} className={`${button} border border-border hover:bg-surface-muted`}>Reject…</button>
            </>
          )}
          {client.status === 'active' && (
            <button type="button" onClick={() => setOpen('revoke')} className={`${button} border border-mismatch text-mismatch hover:bg-mismatch-bg`}>Revoke…</button>
          )}
        </div>
      )}
      {open && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(open, String(new FormData(e.currentTarget).get('note') ?? ''));
          }}
        >
          <label htmlFor={`note-${client.id}`} className="sr-only">Reason</label>
          <input id={`note-${client.id}`} name="note" required minLength={5} maxLength={500} placeholder="Reason (kept in the audit log)" className="min-h-9 min-w-0 flex-1 rounded-lg border border-border px-2 text-sm" />
          <button type="submit" className={`${button} bg-mismatch text-white`}>{open === 'reject' ? 'Reject' : 'Revoke key'}</button>
          <button type="button" onClick={() => setOpen(null)} className={`${button} border border-border`}>Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-mismatch">{error}</p>}
    </div>
  );
}

export function ApiKeys() {
  const admin = useAdmin();
  const q = useAdminApi<Client[]>(admin.role === 'system_admin' ? '/admin/api-clients' : null);
  if (admin.role !== 'system_admin') return <p className="text-ink-muted">Only system administrators can manage API keys.</p>;
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  if (!q.data.length) return <p className="text-ink-muted">No organisation has registered yet.</p>;
  const order: Status[] = ['pending', 'active', 'revoked', 'rejected'];
  const rows = [...q.data].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <ul className="grid gap-4">
      {rows.map((c) => (
        <li key={c.id} className={`${cardClass} grid gap-3 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{c.organisation}</h2>
              <p className="text-sm text-ink-muted">
                {c.contactName} · {c.email}
                {c.website && <> · {c.website}</>}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[c.status]}`}>{LABEL[c.status]}</span>
          </div>
          <p className="text-sm">{c.purpose}</p>
          <p className="text-sm text-ink-muted">
            Key <span className="font-mono">{c.keyPrefix}…</span> · registered {when(c.createdAt)}
            {c.decidedAt && <> · decided {when(c.decidedAt)}</>}
            {c.decisionNote && <> · {c.decisionNote}</>}
            {' · '}
            {c.lastUsedAt ? `${c.requestCount.toLocaleString('en-NG')} requests, last ${when(c.lastUsedAt)}` : 'not used yet'}
          </p>
          <Decide client={c} />
        </li>
      ))}
    </ul>
  );
}
