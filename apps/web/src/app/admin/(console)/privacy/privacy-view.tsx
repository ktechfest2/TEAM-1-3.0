'use client';

import { useState } from 'react';
import { FormError, inputClass } from '@/components/admin/auth-card';
import { cardClass } from '@/components/admin/page-shell';
import { adminPost } from '@/lib/admin-client';
import { ROLE_LABELS, useAdmin, useAdminApi, useAdminRefresh, type AdminRole } from '@/lib/admin-session';

type Access = { id: string; email: string; name: string; role: AdminRole; mfa: boolean; disabledAt: string | null; createdAt: string; lastSignIn: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : 'Never');

const RETENTION: [string, string][] = [
  ['SMS sign-in codes', '1 day'],
  ['One-time camera links', '1 day after they expire'],
  ['Voter and administrator sessions', '7 days after they expire'],
  ['WhatsApp and SMS message records (ids and delivery status only)', '90 days'],
  ['Rejected-photo log', '90 days'],
  ['Unfinished WhatsApp figures or reports', '1 day'],
  ['Accepted evidence, results, declarations, incident reports', 'Until disputes about the election are settled'],
  ['Audit log and hash chain', 'Kept (tamper evidence)'],
];

function Erase() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section aria-labelledby="erase-heading" className={`${cardClass} grid gap-3 p-5`}>
      <h2 id="erase-heading" className="text-lg font-semibold">Erase a person&apos;s data</h2>
      <p className="text-sm text-ink-muted">
        For a request received at the privacy email. Removes the number, its sessions, codes, links and WhatsApp/SMS records. Photos and
        figures already used in results are kept without the number, as the privacy notice says.
      </p>
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const d = new FormData(form);
          setBusy(true);
          setError(null);
          setDone(null);
          const r = await adminPost('/admin/privacy/erase', { phone: d.get('phone') });
          setBusy(false);
          if (!r.ok) return setError(r.message);
          setDone('Erased. Reply to the person to confirm; the audit log records the request without the number.');
          form.reset();
        }}
      >
        <div className="grid gap-1">
          <label htmlFor="erase-phone" className="text-sm font-medium">Phone number</label>
          <input id="erase-phone" name="phone" required inputMode="tel" autoComplete="off" placeholder="0803 123 4567" className={inputClass} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" required className="mt-0.5 size-4" />
          I have checked that the request comes from the owner of this number. This cannot be undone.
        </label>
        <FormError message={error} />
        {done && <p role="status" className="rounded-lg bg-match-bg px-3 py-2 text-sm text-match">{done}</p>}
        <button type="submit" disabled={busy} className="min-h-10 justify-self-start rounded-lg bg-mismatch px-4 text-sm font-semibold text-white disabled:opacity-70">
          {busy ? 'Erasing…' : 'Erase data'}
        </button>
      </form>
    </section>
  );
}

function AccessReview() {
  const me = useAdmin();
  const refresh = useAdminRefresh();
  const q = useAdminApi<Access[]>('/admin/privacy/access');
  const [error, setError] = useState<string | null>(null);
  const toggle = async (a: Access) => {
    const reason = window.prompt(a.disabledAt ? `Why re-enable ${a.name}?` : `Why disable ${a.name}? Their sessions end at once.`);
    if (!reason) return;
    setError(null);
    const r = await adminPost(`/admin/privacy/admins/${a.id}/${a.disabledAt ? 'enable' : 'disable'}`, { reason });
    if (!r.ok) return setError(r.message);
    refresh();
  };
  return (
    <section aria-labelledby="access-heading" className={cardClass}>
      <h2 id="access-heading" className="border-b border-divider px-5 py-3 text-lg font-semibold">Access review</h2>
      {error && <p role="alert" className="px-5 pt-3 text-sm text-mismatch">{error}</p>}
      {q.status === 'ready' && (
        <div tabIndex={0} role="region" aria-labelledby="access-heading" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">Administrator</th>
                <th scope="col" className="px-5 py-2 font-medium">Role</th>
                <th scope="col" className="px-5 py-2 font-medium">Two-factor</th>
                <th scope="col" className="px-5 py-2 font-medium">Last sign-in</th>
                <th scope="col" className="px-5 py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id} className={`border-t border-divider ${a.disabledAt ? 'text-ink-muted' : ''}`}>
                  <th scope="row" className="px-5 py-2 text-left font-medium">{a.name}<span className="block text-xs font-normal text-ink-muted">{a.email}</span></th>
                  <td className="px-5 py-2">{ROLE_LABELS[a.role]}{a.disabledAt ? ' (disabled)' : ''}</td>
                  <td className={`px-5 py-2 ${a.mfa ? '' : 'font-semibold text-dispute'}`}>{a.mfa ? 'On' : 'Not set up'}</td>
                  <td className="px-5 py-2 whitespace-nowrap">{when(a.lastSignIn)}</td>
                  <td className="px-5 py-2 text-right">
                    {a.id !== me.id && (
                      <button type="button" onClick={() => void toggle(a)} className="min-h-8 rounded-lg border border-border px-2.5 font-semibold hover:bg-surface-muted">
                        {a.disabledAt ? 'Enable' : 'Disable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Retention() {
  const [result, setResult] = useState<string | null>(null);
  return (
    <section aria-labelledby="retention-heading" className={`${cardClass} grid gap-3 p-5`}>
      <h2 id="retention-heading" className="text-lg font-semibold">Retention</h2>
      <p className="text-sm text-ink-muted">Runs automatically every 6 hours.</p>
      <table className="w-full text-sm">
        <tbody>
          {RETENTION.map(([what, how]) => (
            <tr key={what} className="border-t border-divider first:border-t-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">{what}</th>
              <td className="py-1.5 text-ink-muted">{how}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={async () => {
          const r = await adminPost<Record<string, number>>('/admin/privacy/retention', {});
          setResult(r.ok ? `Deleted: ${Object.entries(r.data).map(([k, v]) => `${v} ${k}`).join(', ')}` : r.message);
        }}
        className="min-h-10 justify-self-start rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-muted"
      >
        Run now
      </button>
      {result && <p role="status" className="text-sm">{result}</p>}
    </section>
  );
}

export function Privacy() {
  const admin = useAdmin();
  if (admin.role !== 'system_admin') return <p className="text-ink-muted">Only system administrators can manage privacy requests and access.</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="grid gap-6">
        <Erase />
        <Retention />
      </div>
      <AccessReview />
    </div>
  );
}
