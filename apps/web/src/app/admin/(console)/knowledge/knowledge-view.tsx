'use client';

import { useState } from 'react';
import { FormError, inputClass } from '@/components/admin/auth-card';
import { cardClass } from '@/components/admin/page-shell';
import { adminPost } from '@/lib/admin-client';
import { useAdmin, useAdminApi, useAdminRefresh } from '@/lib/admin-session';

type Entry = {
  id: string;
  topic: string;
  fact: string;
  sourceName: string;
  sourceUrl: string | null;
  status: 'pending' | 'approved' | 'retired';
  enteredById: string | null;
  enteredBy: string | null;
  approvedBy: string | null;
  updatedAt: string;
};

const STATUS_CLASS = { pending: 'bg-pending-bg text-pending', approved: 'bg-match-bg text-match', retired: 'bg-surface-muted text-ink-muted' };

function EntryForm({ entry, onDone }: { entry?: Entry; onDone: () => void }) {
  const refresh = useAdminRefresh();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = entry?.id ?? 'new';
  return (
    <form
      method="post"
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const result = await adminPost(entry ? `/admin/knowledge/${entry.id}` : '/admin/knowledge', {
          topic: d.get('topic'),
          fact: d.get('fact'),
          sourceName: d.get('sourceName'),
          sourceUrl: String(d.get('sourceUrl') ?? '').trim() || null,
        });
        setBusy(false);
        if (!result.ok) return setError(result.message);
        refresh();
        onDone();
      }}
    >
      <div className="grid gap-1">
        <label htmlFor={`topic-${id}`} className="text-sm font-medium">Topic</label>
        <input id={`topic-${id}`} name="topic" required minLength={3} maxLength={80} defaultValue={entry?.topic} className={inputClass} />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`fact-${id}`} className="text-sm font-medium">Fact (plain language, as voters should hear it)</label>
        <textarea id={`fact-${id}`} name="fact" required minLength={20} maxLength={800} rows={4} defaultValue={entry?.fact} className={`${inputClass} py-2`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`source-${id}`} className="text-sm font-medium">Official source</label>
          <input id={`source-${id}`} name="sourceName" required minLength={3} placeholder="e.g. Electoral Act 2022, section 47" defaultValue={entry?.sourceName} className={inputClass} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`url-${id}`} className="text-sm font-medium">Link <span className="text-ink-muted">(optional)</span></label>
          <input id={`url-${id}`} name="sourceUrl" type="url" inputMode="url" placeholder="https://inecnigeria.org/…" defaultValue={entry?.sourceUrl ?? ''} className={inputClass} />
        </div>
      </div>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70">
          {busy ? 'Saving…' : 'Save for approval'}
        </button>
        {entry && (
          <button type="button" onClick={onDone} className="min-h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-muted">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Actions({ entry, canApprove, canEdit, mine, onEdit }: { entry: Entry; canApprove: boolean; canEdit: boolean; mine: boolean; onEdit: () => void }) {
  const refresh = useAdminRefresh();
  const [error, setError] = useState<string | null>(null);
  const act = async (path: 'approve' | 'retire') => {
    setError(null);
    const r = await adminPost(`/admin/knowledge/${entry.id}/${path}`, {});
    if (!r.ok) return setError(r.message);
    refresh();
  };
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && entry.status !== 'retired' && (
          <button type="button" onClick={onEdit} className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-muted">Edit</button>
        )}
        {canApprove && entry.status === 'approved' && (
          <button type="button" onClick={() => void act('retire')} className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-muted">Retire</button>
        )}
        {canApprove && entry.status === 'pending' && !mine && (
          <button type="button" onClick={() => void act('approve')} className="min-h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-ink hover:bg-brand-strong">Approve</button>
        )}
      </div>
      {canApprove && entry.status === 'pending' && mine && <p className="text-sm text-ink-muted">Waiting for a second administrator</p>}
      {error && <p role="alert" className="text-sm text-mismatch">{error}</p>}
    </div>
  );
}

export function Knowledge() {
  const admin = useAdmin();
  const q = useAdminApi<Entry[]>('/admin/knowledge');
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = admin.role === 'declarations_admin' || admin.role === 'system_admin';
  const canApprove = admin.role === 'approver' || admin.role === 'system_admin';
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  const approved = q.data.filter((e) => e.status === 'approved').length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem] lg:items-start">
      <section aria-labelledby="facts-heading" className={cardClass}>
        <h2 id="facts-heading" className="border-b border-divider px-5 py-4 text-lg font-semibold">
          Facts <span className="text-ink-muted tabular">({approved} in use)</span>
        </h2>
        <ul>
          {q.data.map((e) => (
            <li key={e.id} className="grid gap-2 border-t border-divider px-5 py-4 first:border-t-0">
              {editing === e.id ? (
                <EntryForm entry={e} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{e.topic}</h3>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_CLASS[e.status]}`}>{e.status === 'approved' ? 'in use' : e.status}</span>
                    </div>
                    <Actions entry={e} canApprove={canApprove} canEdit={canEdit} mine={e.enteredById === admin.id} onEdit={() => setEditing(e.id)} />
                  </div>
                  <p className="max-w-[75ch]">{e.fact}</p>
                  <p className="text-sm text-ink-muted">
                    Source: {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-strong hover:underline">{e.sourceName}</a> : e.sourceName}
                    {e.enteredBy ? ` · entered by ${e.enteredBy}` : ' · initial set'}
                    {e.approvedBy ? ` · approved by ${e.approvedBy}` : ''}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      {canEdit ? (
        <section aria-labelledby="new-fact" className={`${cardClass} grid gap-3 p-5`}>
          <h2 id="new-fact" className="text-lg font-semibold">Add a fact</h2>
          <p className="text-sm text-ink-muted">Official sources only (INEC, the Electoral Act, government sites). Links must be on inecnigeria.org, inecelectionresults.ng or a .gov.ng site.</p>
          <EntryForm key={q.data.length} onDone={() => undefined} />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">Declarations administrators add facts; approvers check and approve them.</p>
      )}
    </div>
  );
}
