'use client';

import { useAdminRefresh } from '@/lib/admin-session';
import { useState } from 'react';
import { FormError } from '@/components/admin/auth-card';
import { adminPost } from '@/lib/admin-client';

export function ResolveForm({
  electionId,
  unitCode,
  versions,
}: {
  electionId: string;
  unitCode: string;
  versions: { id: string; label: string }[];
}) {
  const refresh = useAdminRefresh();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      method="post"
      aria-labelledby="resolve-heading"
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const result = await adminPost('/admin/review/resolve', {
          electionId,
          unitCode,
          versionId: d.get('versionId'),
          reason: d.get('reason'),
        });
        setBusy(false);
        if (!result.ok) return setError(result.message);
        refresh();
      }}
    >
      <h2 id="resolve-heading" className="text-lg font-semibold">Decide which version counts</h2>
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">Version supported by the evidence</legend>
        {versions.map((v) => (
          <label key={v.id} className="flex items-start gap-2">
            <input type="radio" name="versionId" value={v.id} required className="mt-1 size-4" />
            <span>{v.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-1.5">
        <label htmlFor="reason" className="font-medium">Reason</label>
        <p id="reason-hint" className="text-sm text-ink-muted">
          Recorded in the audit log and shown in evidence packs. Say what you checked.
        </p>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          aria-describedby="reason-hint"
          className="rounded-xl border border-border bg-surface px-3 py-2 text-[max(1rem,1em)]"
        />
      </div>
      <FormError message={error} />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70"
      >
        {busy ? 'Saving…' : 'Record decision'}
      </button>
    </form>
  );
}
