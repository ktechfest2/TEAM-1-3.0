'use client';

import { useState } from 'react';
import { inputClass } from '@/components/admin/auth-card';
import { cardClass } from '@/components/admin/page-shell';
import { useAdmin, useAdminApi } from '@/lib/admin-session';

type Row = { id: number; at: string; action: string; targetType: string; targetId: string | null; details: unknown; admin: string | null };

export function AuditLog() {
  const admin = useAdmin();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [before, setBefore] = useState<number | null>(null);
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  if (before) params.set('before', String(before));
  const q = useAdminApi<{ rows: Row[]; next: number | null }>(admin.role === 'system_admin' ? `/admin/ops/audit?${params}` : null);
  if (admin.role !== 'system_admin') return <p className="text-ink-muted">Only system administrators can see the audit log.</p>;

  return (
    <div className="grid gap-4">
      <form
        className={`${cardClass} grid gap-3 p-4 sm:grid-cols-[1fr_12rem_10rem_10rem_auto] sm:items-end`}
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const day = (v: FormDataEntryValue | null, end = false) => (v ? `${v}T${end ? '23:59:59' : '00:00:00'}+01:00` : '');
          setBefore(null);
          setFilters({ q: String(d.get('q') ?? '').trim(), action: String(d.get('action') ?? ''), from: day(d.get('from')), to: day(d.get('to'), true) });
        }}
      >
        <div className="grid gap-1">
          <label htmlFor="q" className="text-sm font-medium">Search</label>
          <input id="q" name="q" placeholder="Name, target, details…" className={inputClass} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="action" className="text-sm font-medium">Action</label>
          <select id="action" name="action" className={inputClass}>
            <option value="">All</option>
            {['auth.', 'declaration.', 'unit.', 'incident.', 'reporter.', 'knowledge.', 'election.', 'party.', 'evidence.', 'admin.'].map((a) => (
              <option key={a} value={a}>{a.slice(0, -1)}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="from" className="text-sm font-medium">From</label>
          <input id="from" name="from" type="date" className={inputClass} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-sm font-medium">To</label>
          <input id="to" name="to" type="date" className={inputClass} />
        </div>
        <button type="submit" className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong">Search</button>
      </form>

      {q.status === 'loading' && <p role="status" className="text-ink-muted">Loading…</p>}
      {q.status === 'error' && <p className="text-mismatch">{q.error.message}</p>}
      {q.status === 'ready' && (
        <section className={cardClass} aria-label="Entries">
          {q.data.rows.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">No entries.</p>
          ) : (
            <div tabIndex={0} role="region" aria-label="Audit entries" className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">When</th>
                    <th scope="col" className="px-4 py-2 font-medium">Who</th>
                    <th scope="col" className="px-4 py-2 font-medium">Action</th>
                    <th scope="col" className="px-4 py-2 font-medium">Target</th>
                    <th scope="col" className="px-4 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-divider align-top">
                      <td className="px-4 py-2 whitespace-nowrap tabular">{new Date(r.at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</td>
                      <td className="px-4 py-2">{r.admin ?? 'System'}</td>
                      <td className="px-4 py-2 font-mono">{r.action}</td>
                      <td className="px-4 py-2 font-mono text-xs [overflow-wrap:anywhere]">{r.targetType}{r.targetId ? ` ${r.targetId}` : ''}</td>
                      <td className="max-w-md px-4 py-2 font-mono text-xs [overflow-wrap:anywhere] text-ink-muted">{r.details ? JSON.stringify(r.details) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2 border-t border-divider px-5 py-3">
            {before && <button type="button" onClick={() => setBefore(null)} className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold">Newest</button>}
            {q.data.next && <button type="button" onClick={() => setBefore(q.data.next)} className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold">Older entries</button>}
          </div>
        </section>
      )}
    </div>
  );
}
