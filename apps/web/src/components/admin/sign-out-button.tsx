'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl, authHeaders, sessionToken } from '@/lib/api';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(apiUrl('/admin/auth/logout'), { method: 'POST', headers: authHeaders('admin') }).catch(() => null);
        sessionToken.clear('admin');
        router.replace('/admin/login');
      }}
      className="inline-flex min-h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-muted disabled:opacity-70"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
