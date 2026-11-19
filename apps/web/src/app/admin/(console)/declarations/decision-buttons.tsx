'use client';

import { useAdminRefresh } from '@/lib/admin-session';
import { useState } from 'react';
import { adminPost } from '@/lib/admin-client';

export function DecisionButtons({ id }: { id: string }) {
  const refresh = useAdminRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(path: 'approve' | 'reject') {
    let body = {};
    if (path === 'approve') {
      if (!window.confirm('Approve this declaration? It will be published and compared with citizen results. Check it against the source first.')) return;
    } else {
      const reason = window.prompt('Why are you rejecting this declaration? (at least 10 characters)');
      if (!reason) return;
      body = { reason };
    }
    setBusy(true);
    setError(null);
    const result = await adminPost(`/admin/declarations/${id}/${path}`, body);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    refresh();
  }

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('reject')}
          className="min-h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-70"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('approve')}
          className="min-h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70"
        >
          Approve
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-mismatch">{error}</p>}
    </div>
  );
}
