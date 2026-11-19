'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cardClass } from '@/components/admin/page-shell';
import { adminPost } from '@/lib/admin-client';
import { useAdmin, useAdminApi, useAdminRefresh } from '@/lib/admin-session';
import { FLAG_LABELS } from '../review/flags';

type Num = { reporterId: string; phone: string; blocked: boolean };
type Clusters = {
  sharedDevices: { photos: number; last: string; numbers: Num[] }[];
  samePicture: { unitCode: string; electionTitle: string; numbers: Num[] }[];
  flaggedUnits: { unitCode: string; electionId: string; electionTitle: string; flags: string[]; status: string; updatedAt: string }[];
  repeatedRejections: { rejections: number; reasons: string[]; number: Num }[];
};
type Blocked = { reporterId: string; phone: string; blockedAt: string; reason: string | null };

const when = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

function NumberRow({ n, canAct }: { n: Num; canAct: boolean }) {
  const refresh = useAdminRefresh();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{n.phone}</span>
        {n.blocked && <span className="rounded-full bg-mismatch-bg px-2 py-0.5 text-xs font-semibold text-mismatch">Blocked</span>}
        {canAct && !n.blocked && !open && (
          <button type="button" onClick={() => setOpen(true)} className="min-h-8 rounded-lg border border-border px-2.5 text-sm font-semibold hover:bg-surface-muted">
            Block…
          </button>
        )}
      </div>
      {open && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await adminPost(`/admin/abuse/numbers/${n.reporterId}/block`, { reason: new FormData(e.currentTarget).get('reason') });
            if (!r.ok) return setError(r.message);
            setOpen(false);
            refresh();
          }}
        >
          <label htmlFor={`reason-${n.reporterId}`} className="sr-only">Reason</label>
          <input id={`reason-${n.reporterId}`} name="reason" required minLength={5} placeholder="Reason (kept in the audit log)" className="min-h-9 min-w-0 flex-1 rounded-lg border border-border px-2 text-sm" />
          <button type="submit" className="min-h-9 rounded-lg bg-mismatch px-3 text-sm font-semibold text-white">Block number</button>
          <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-lg border border-border px-3 text-sm">Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-mismatch">{error}</p>}
    </li>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className={cardClass} aria-label={title}>
      <h2 className="border-b border-divider px-5 py-3 font-semibold">{title}</h2>
      {empty ? <p className="px-5 py-4 text-sm text-ink-muted">Nothing found.</p> : <ul className="divide-y divide-divider">{children}</ul>}
    </section>
  );
}

function BlockedList({ canAct }: { canAct: boolean }) {
  const refresh = useAdminRefresh();
  const q = useAdminApi<Blocked[]>('/admin/abuse/blocked');
  if (q.status !== 'ready') return null;
  return (
    <Section title={`Blocked numbers (${q.data.length})`} empty={!q.data.length}>
      {q.data.map((b) => (
        <li key={b.reporterId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
          <span>
            <span className="font-mono">{b.phone}</span> · {when(b.blockedAt)} · {b.reason}
          </span>
          {canAct && (
            <button
              type="button"
              onClick={async () => {
                const r = await adminPost(`/admin/abuse/numbers/${b.reporterId}/unblock`, { reason: 'Unblocked after review' });
                if (r.ok) refresh();
              }}
              className="min-h-8 rounded-lg border border-border px-2.5 font-semibold hover:bg-surface-muted"
            >
              Unblock
            </button>
          )}
        </li>
      ))}
    </Section>
  );
}

export function Abuse() {
  const admin = useAdmin();
  const canAct = admin.role === 'reviewer' || admin.role === 'system_admin';
  const q = useAdminApi<Clusters>('/admin/abuse');
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  const c = q.data;
  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <Section title="Same picture from several numbers" empty={!c.samePicture.length}>
        {c.samePicture.map((p) => (
          <li key={`${p.unitCode}-${p.electionTitle}`} className="grid gap-2 px-5 py-3">
            <p className="text-sm text-ink-muted">
              <span className="font-mono">{p.unitCode}</span> · {p.electionTitle} · counted as one witness
            </p>
            <ul className="grid gap-2">{p.numbers.map((n) => <NumberRow key={n.reporterId} n={n} canAct={canAct} />)}</ul>
          </li>
        ))}
      </Section>
      <Section title="One device, several numbers" empty={!c.sharedDevices.length}>
        {c.sharedDevices.map((d, i) => (
          <li key={i} className="grid gap-2 px-5 py-3">
            <p className="text-sm text-ink-muted">{d.photos} photos · last {when(d.last)} · counted as one witness</p>
            <ul className="grid gap-2">{d.numbers.map((n) => <NumberRow key={n.reporterId} n={n} canAct={canAct} />)}</ul>
          </li>
        ))}
      </Section>
      <Section title="Numbers with repeated rejections (last 24 hours)" empty={!c.repeatedRejections.length}>
        {c.repeatedRejections.map((r) => (
          <li key={r.number.reporterId} className="grid gap-2 px-5 py-3">
            <p className="text-sm text-ink-muted">{r.rejections} rejected photos · {r.reasons.join(', ').replaceAll('_', ' ')}</p>
            <ul><NumberRow n={r.number} canAct={canAct} /></ul>
          </li>
        ))}
      </Section>
      <Section title="Polling units with warning signs" empty={!c.flaggedUnits.length}>
        {c.flaggedUnits.map((u) => (
          <li key={`${u.electionId}-${u.unitCode}`} className="px-5 py-3 text-sm">
            <Link href={`/admin/review/unit?election=${u.electionId}&code=${u.unitCode}`} className="font-mono font-semibold text-brand-strong hover:underline">{u.unitCode}</Link>{' '}
            · {u.electionTitle} · {u.flags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}
          </li>
        ))}
      </Section>
      <div className="lg:col-span-2">
        <BlockedList canAct={canAct} />
      </div>
    </div>
  );
}
