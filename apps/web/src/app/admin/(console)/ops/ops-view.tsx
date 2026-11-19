'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cardClass } from '@/components/admin/page-shell';
import { adminPost } from '@/lib/admin-client';
import { apiUrl } from '@/lib/api-url';
import { useAdmin, useAdminApi, useAdminRefresh } from '@/lib/admin-session';

type Mix = { high: number; medium: number; low: number; provisional: number; disputed: number; notConfirmed: number };
type Alert = { level: 'critical' | 'warning'; code: string; title: string; detail: string; link?: string };
type Dashboard = {
  election: { id: string; title: string; status: string };
  generatedAt: string;
  totals: { countedUnits: number; totalUnits: number; mix: Mix; comparison?: { status: string } };
  areas: { code: string; name: string; countedUnits: number; totalUnits: number; mix: Mix; comparison: string | null }[];
  areaLevel: string;
  lastHour: { status: string; kind: string; n: number }[];
  backlog: { pending: number; oldest: string | null };
  review: { status: string; assigned: boolean; n: number }[];
  incidents: { label: string; status: string; n: number }[];
  alerts: Alert[];
};
type QueueItem = { kind: 'unit' | 'incident' | 'declaration'; priority: number; key: string; title: string; detail: string; since: string; assignedTo: string | null; assignee: string | null; link: string };
type Workload = { id: string; name: string; open: number; decidedToday: number; medianMinutes: number | null };
type Election = { id: string; title: string; status: string };

const n = (v: number) => v.toLocaleString('en-NG');
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const COMPARISON: Record<string, string> = {
  match: 'Match',
  match_so_far: 'Match so far',
  does_not_match: 'Does not match',
  possible_mismatch_low_confidence: 'Possible mismatch',
  conflicting_declarations: 'Conflicting declarations',
  awaiting_data: 'Awaiting data',
};

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`${cardClass} px-4 py-3`}>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={`text-2xl font-bold tabular ${tone}`}>{value}</dd>
    </div>
  );
}

/** Live: the public results stream says when anything changes; a 15 s refresh catches the rest */
function useLive(electionId: string | null) {
  const refresh = useAdminRefresh();
  useEffect(() => {
    if (!electionId) return;
    const source = new EventSource(apiUrl(`/results/elections/${electionId}/stream`));
    source.addEventListener('update', () => refresh());
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, [electionId, refresh]);
}

function Board({ electionId }: { electionId: string }) {
  const q = useAdminApi<Dashboard>(`/admin/ops/dashboard?electionId=${electionId}`);
  useLive(electionId);
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  const d = q.data;
  const count = (rows: { n: number }[]) => rows.reduce((a, r) => a + r.n, 0);
  const needs = count(d.review);
  const unassigned = count(d.review.filter((r) => !r.assigned));
  return (
    <div className="grid gap-6">
      <section aria-labelledby="alerts-heading" className="grid gap-2">
        <h2 id="alerts-heading" className="text-lg font-semibold">Alerts</h2>
        <div aria-live="polite" className="grid gap-2">
          {d.alerts.length === 0 ? (
            <p className="rounded-xl bg-match-bg px-4 py-3 text-match">No alerts.</p>
          ) : (
            d.alerts.map((a) => (
              <p key={a.code} className={`rounded-xl border px-4 py-3 ${a.level === 'critical' ? 'border-mismatch bg-mismatch-bg text-mismatch' : 'border-dispute bg-dispute-bg text-dispute'}`}>
                <strong>{a.title}.</strong> {a.detail}{' '}
                {a.link && <Link href={a.link} className="font-semibold underline">Open</Link>}
              </p>
            ))
          )}
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Units counted" value={`${n(d.totals.countedUnits)} / ${n(d.totals.totalUnits)}`} />
        <Stat label="Disputed / provisional" value={`${n(d.totals.mix.disputed)} / ${n(d.totals.mix.provisional)}`} tone={d.totals.mix.disputed ? 'text-mismatch' : ''} />
        <Stat label="Need review (unassigned)" value={`${n(needs)} (${n(unassigned)})`} tone={unassigned ? 'text-dispute' : ''} />
        <Stat label="Photos waiting for checks" value={`${n(d.backlog.pending)}${d.backlog.oldest ? ` · ${ago(d.backlog.oldest)}` : ''}`} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="areas-heading" className={cardClass}>
          <h2 id="areas-heading" className="border-b border-divider px-5 py-3 font-semibold">By {d.areaLevel.replace('_', ' ')}</h2>
          <div tabIndex={0} role="region" aria-labelledby="areas-heading" className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-muted text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Area</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Counted</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Disputed</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Provisional</th>
                  <th scope="col" className="px-4 py-2 font-medium">Comparison</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...d.areas]
                  .sort((a, b) => b.mix.disputed + b.mix.provisional - (a.mix.disputed + a.mix.provisional) || b.countedUnits - a.countedUnits)
                  .map((a) => (
                    <tr key={a.code} className="border-t border-divider">
                      <th scope="row" className="px-4 py-2 text-left font-medium">{a.name}</th>
                      <td className="px-4 py-2 text-right">{n(a.countedUnits)} / {n(a.totalUnits)}</td>
                      <td className={`px-4 py-2 text-right ${a.mix.disputed ? 'font-semibold text-mismatch' : ''}`}>{n(a.mix.disputed)}</td>
                      <td className="px-4 py-2 text-right">{n(a.mix.provisional)}</td>
                      <td className={`px-4 py-2 ${a.comparison === 'does_not_match' ? 'font-semibold text-mismatch' : ''}`}>{a.comparison ? COMPARISON[a.comparison] : '–'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="grid content-start gap-4">
          <section className={`${cardClass} p-4`} aria-labelledby="hour-heading">
            <h2 id="hour-heading" className="mb-2 font-semibold">Last hour</h2>
            <ul className="grid gap-1 text-sm">
              {d.lastHour.length === 0 && <li className="text-ink-muted">Nothing received.</li>}
              {d.lastHour.map((r) => (
                <li key={`${r.kind}-${r.status}`} className="flex justify-between"><span>{r.kind === 'typed' ? 'Typed figures' : 'Photos'} {r.status.replace('_', ' ')}</span><span className="tabular">{n(r.n)}</span></li>
              ))}
            </ul>
          </section>
          <section className={`${cardClass} p-4`} aria-labelledby="inc-heading">
            <h2 id="inc-heading" className="mb-2 font-semibold">Incidents (24 h)</h2>
            <ul className="grid gap-1 text-sm">
              {d.incidents.length === 0 && <li className="text-ink-muted">None.</li>}
              {d.incidents.map((r) => (
                <li key={`${r.label}-${r.status}`} className="flex justify-between"><span>{r.label.replace('_', ' ')} · {r.status}</span><span className="tabular">{n(r.n)}</span></li>
              ))}
            </ul>
            <Link href="/admin/incidents" className="mt-2 inline-block text-sm font-semibold text-brand-strong hover:underline">Review incidents</Link>
          </section>
        </div>
      </div>
      <p className="text-xs text-ink-muted">Updated {new Date(d.generatedAt).toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos' })}</p>
    </div>
  );
}

function Queue() {
  const admin = useAdmin();
  const refresh = useAdminRefresh();
  const q = useAdminApi<QueueItem[]>('/admin/ops/queue');
  const [error, setError] = useState<string | null>(null);
  const canClaim = admin.role === 'reviewer' || admin.role === 'system_admin';
  const assign = async (item: QueueItem, to: string | null) => {
    setError(null);
    const r = await adminPost('/admin/ops/assign', { kind: item.kind, key: item.key, to });
    if (!r.ok) return setError(r.message);
    refresh();
  };
  if (q.status !== 'ready') return null;
  return (
    <section aria-labelledby="queue-heading" className={cardClass}>
      <h2 id="queue-heading" className="border-b border-divider px-5 py-3 font-semibold">Waiting for a person ({q.data.length})</h2>
      {error && <p role="alert" className="px-5 pt-3 text-sm text-mismatch">{error}</p>}
      {q.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {q.data.slice(0, 100).map((i) => (
            <li key={`${i.kind}-${i.key}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="grid gap-0.5">
                <Link href={i.link} className="font-semibold text-brand-strong hover:underline">{i.title}</Link>
                <p className="text-sm text-ink-muted">{i.detail} · waiting {ago(i.since)}{i.assignee ? ` · with ${i.assignee}` : ''}</p>
              </div>
              {canClaim && i.kind !== 'declaration' && (
                i.assignedTo === admin.id ? (
                  <button type="button" onClick={() => void assign(i, null)} className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-muted">Release</button>
                ) : !i.assignedTo ? (
                  <button type="button" onClick={() => void assign(i, admin.id)} className="min-h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-ink hover:bg-brand-strong">Claim</button>
                ) : null
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WorkloadTable() {
  const q = useAdminApi<Workload[]>('/admin/ops/workload');
  if (q.status !== 'ready') return null;
  return (
    <section aria-labelledby="work-heading" className={cardClass}>
      <h2 id="work-heading" className="border-b border-divider px-5 py-3 font-semibold">Reviewers</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-ink-muted">
          <tr>
            <th scope="col" className="px-5 py-2 font-medium">Reviewer</th>
            <th scope="col" className="px-5 py-2 text-right font-medium">Open</th>
            <th scope="col" className="px-5 py-2 text-right font-medium">Decided today</th>
            <th scope="col" className="px-5 py-2 text-right font-medium">Median time to decide</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {q.data.map((w) => (
            <tr key={w.id} className="border-t border-divider">
              <th scope="row" className="px-5 py-2 text-left font-medium">{w.name}</th>
              <td className="px-5 py-2 text-right">{w.open}</td>
              <td className="px-5 py-2 text-right">{w.decidedToday}</td>
              <td className="px-5 py-2 text-right">{w.medianMinutes === null ? '–' : `${Math.round(w.medianMinutes)} min`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Ops() {
  const elections = useAdminApi<Election[]>('/admin/elections');
  const [chosen, setChosen] = useState<string | null>(null);
  if (elections.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (elections.status === 'error') return <p className="text-mismatch">{elections.error.message}</p>;
  const list = elections.data.filter((e) => e.status !== 'draft');
  const electionId = chosen ?? list.find((e) => e.status === 'active')?.id ?? list[0]?.id ?? null;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="election" className="font-semibold">Election</label>
        <select id="election" value={electionId ?? ''} onChange={(e) => setChosen(e.target.value)} className="min-h-10 rounded-lg border border-border bg-surface px-3">
          {list.map((e) => (
            <option key={e.id} value={e.id}>{e.title}{e.status === 'closed' ? ' (closed)' : ''}</option>
          ))}
        </select>
      </div>
      {electionId ? <Board key={electionId} electionId={electionId} /> : <p className="text-ink-muted">No published election yet.</p>}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Queue />
        <WorkloadTable />
      </div>
    </div>
  );
}
