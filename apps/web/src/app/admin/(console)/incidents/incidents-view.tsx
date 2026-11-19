'use client';

import { useState } from 'react';
import { FormError, inputClass } from '@/components/admin/auth-card';
import { AuthImage } from '@/components/admin/auth-image';
import { cardClass } from '@/components/admin/page-shell';
import { adminPost } from '@/lib/admin-client';
import { useAdmin, useAdminApi, useAdminRefresh } from '@/lib/admin-session';

type Report = {
  id: string;
  reference: string;
  typeText: string;
  claim: string;
  channel: string;
  status: 'pending' | 'published' | 'held' | 'hidden';
  label: string;
  labelText: string;
  assessment: {
    ai?: { shows_claim: string; description: string; signs_of_editing: boolean; screenshot_or_forwarded: boolean; identifies_private_person: boolean } | null;
    reused?: boolean;
    suggestedLabel?: string;
  } | null;
  corroboration: number;
  receivedAt: string;
  capturedAt: string | null;
  reviewNote: string | null;
  unitCode: string;
  unitName: string;
};

const LABELS = [
  ['supported', 'Supported by evidence'],
  ['partly_supported', 'Partly supported'],
  ['not_supported', 'Not supported by evidence'],
  ['unconfirmed', 'Unconfirmed'],
] as const;
const STATUS_CLASS = { pending: 'bg-pending-bg text-pending', held: 'bg-dispute-bg text-dispute', published: 'bg-match-bg text-match', hidden: 'bg-surface-muted text-ink-muted' };
const when = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

function ReviewForm({ report }: { report: Report }) {
  const refresh = useAdminRefresh();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = report.assessment?.suggestedLabel;
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const r = await adminPost(`/admin/incidents/${report.id}/review`, { label: d.get('label'), publish: d.get('publish') === 'yes', note: d.get('note') });
        setBusy(false);
        if (!r.ok) return setError(r.message);
        refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`label-${report.id}`} className="text-sm font-medium">Label</label>
          <select id={`label-${report.id}`} name="label" defaultValue={suggested && suggested !== 'under_review' ? suggested : 'unconfirmed'} className={inputClass}>
            {LABELS.map(([v, t]) => (
              <option key={v} value={v}>{t}{v === suggested ? ' (AI suggestion)' : ''}</option>
            ))}
          </select>
        </div>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium">Publication</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="publish" value="yes" defaultChecked className="size-4" /> Publish with this label</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="publish" value="no" className="size-4" /> Do not publish</label>
        </fieldset>
      </div>
      <div className="grid gap-1">
        <label htmlFor={`note-${report.id}`} className="text-sm font-medium">Reason (kept in the audit log)</label>
        <textarea id={`note-${report.id}`} name="note" required minLength={5} maxLength={1000} rows={2} className={`${inputClass} py-2`} />
      </div>
      <FormError message={error} />
      <button type="submit" disabled={busy} className="min-h-10 justify-self-start rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70">
        {busy ? 'Saving…' : 'Save decision'}
      </button>
    </form>
  );
}

export function Incidents() {
  const admin = useAdmin();
  const [scope, setScope] = useState<'held' | 'all'>('held');
  const q = useAdminApi<Report[]>(`/admin/incidents?scope=${scope}`);
  const canReview = admin.role === 'reviewer' || admin.role === 'system_admin';

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Show" className="flex gap-2">
        {(['held', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold aria-pressed:border-brand aria-pressed:bg-surface-tint"
          >
            {s === 'held' ? 'Waiting for review' : 'All reports'}
          </button>
        ))}
      </div>
      {q.status === 'loading' && <p role="status" className="text-ink-muted">Loading…</p>}
      {q.status === 'error' && <p className="text-mismatch">{q.error.message}</p>}
      {q.status === 'ready' && q.data.length === 0 && <p className={`${cardClass} px-5 py-6 text-ink-muted`}>Nothing waiting for review.</p>}
      {q.status === 'ready' &&
        q.data.map((r) => {
          const ai = r.assessment?.ai;
          const flags = [
            r.assessment?.reused && 'Image reused from another report or result photo',
            ai?.signs_of_editing && 'Signs of editing',
            ai?.screenshot_or_forwarded && 'Screenshot or forwarded',
            ai?.identifies_private_person && 'May identify a private person',
          ].filter(Boolean);
          return (
            <article key={r.id} className={`${cardClass} grid gap-4 p-5 lg:grid-cols-[14rem_1fr]`} aria-labelledby={`r-${r.id}`}>
              <AuthImage path={`/admin/incidents/${r.id}/evidence`} alt={`Evidence for ${r.reference}`} className="aspect-[3/4] w-full rounded-lg border border-divider object-cover" />
              <div className="grid content-start gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`r-${r.id}`} className="font-semibold">{r.typeText}</h2>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                  <span className="text-sm text-ink-muted">{r.labelText}</span>
                </div>
                <p>{r.claim}</p>
                <p className="text-sm text-ink-muted">
                  {r.unitName} (<span className="font-mono">{r.unitCode}</span>) · received {when(r.receivedAt)}
                  {r.capturedAt ? ` · photo taken ${when(r.capturedAt)}` : ''} · {r.channel === 'web' ? 'live camera' : 'WhatsApp image'}
                  {r.corroboration ? ` · ${r.corroboration} other ${r.corroboration === 1 ? 'person' : 'people'} reported the same` : ''} · <span className="font-mono">{r.reference}</span>
                </p>
                {ai ? (
                  <p className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                    <strong>AI:</strong> {ai.description} Shows the claim: <strong>{ai.shows_claim}</strong>.
                  </p>
                ) : (
                  r.status !== 'pending' && <p className="text-sm text-ink-muted">The AI could not assess this photo.</p>
                )}
                {flags.length > 0 && <p className="rounded-xl border border-dispute bg-dispute-bg px-3 py-2 text-sm text-dispute">{flags.join(' · ')}</p>}
                {r.reviewNote && <p className="text-sm"><strong>Review:</strong> {r.reviewNote}</p>}
                {canReview && r.status !== 'pending' && <ReviewForm report={r} />}
              </div>
            </article>
          );
        })}
    </div>
  );
}
