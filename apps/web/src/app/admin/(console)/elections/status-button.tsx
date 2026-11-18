'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminPost } from '@/lib/admin-client';
import type { ElectionStatus } from './labels';

const ACTIONS: Partial<Record<ElectionStatus, { to: 'active' | 'closed'; label: string; confirm: string }>> = {
  draft: {
    to: 'active',
    label: 'Make active',
    confirm: 'Make this election active? It becomes visible to the public and starts accepting photographs. This cannot be undone.',
  },
  active: {
    to: 'closed',
    label: 'Close',
    confirm: 'Close this election? It stops accepting new photographs. This cannot be undone.',
  },
};

export function StatusButton({ id, status }: { id: string; status: ElectionStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = ACTIONS[status];
  if (!action) return null;

  return (
    <div className="grid justify-items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(action.confirm)) return;
          setBusy(true);
          setError(null);
          const result = await adminPost(`/admin/elections/${id}/status`, { status: action.to });
          setBusy(false);
          if (!result.ok) return setError(result.message);
          router.refresh();
        }}
        className="inline-flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-muted disabled:opacity-70"
      >
        {busy ? 'Saving…' : action.label}
      </button>
      {error && <p role="alert" className="text-sm text-mismatch">{error}</p>}
    </div>
  );
}
