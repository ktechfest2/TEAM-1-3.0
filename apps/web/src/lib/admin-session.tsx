'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionToken, useApi } from './api';

export type AdminRole = 'reviewer' | 'declarations_admin' | 'approver' | 'system_admin';

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  mfaVerified: boolean;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  reviewer: 'Reviewer',
  declarations_admin: 'Declarations administrator',
  approver: 'Approver',
  system_admin: 'System administrator',
};

type AdminContext = { admin: AdminProfile; version: number; refresh: () => void };
const Context = createContext<AdminContext | null>(null);

/**
 * Admin console gate: checks the session with the API before showing anything, and sends
 * the browser to sign-in (no session) or two-factor setup (password only). The API checks
 * the session and role on every request; this only decides what to show.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [hasToken] = useState(() => typeof window !== 'undefined' && !!sessionToken.get('admin'));
  const me = useApi<AdminProfile>(hasToken ? '/admin/auth/me' : null, 'admin');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const signedOut = !hasToken || (me.status === 'error' && me.error.status === 401);
  const pendingMfa = me.status === 'ready' && !me.data.mfaVerified;
  useEffect(() => {
    if (signedOut) {
      sessionToken.clear('admin');
      router.replace('/admin/login');
    } else if (pendingMfa) router.replace('/admin/setup-2fa');
  }, [signedOut, pendingMfa, router]);

  if (me.status === 'error' && !signedOut) {
    return <p className="mx-auto max-w-6xl px-4 py-8 text-mismatch sm:px-6">{me.error.message}</p>;
  }
  if (me.status !== 'ready' || !me.data.mfaVerified) {
    return <p role="status" className="mx-auto max-w-6xl px-4 py-8 text-ink-muted sm:px-6">Checking your session…</p>;
  }
  return <Context.Provider value={{ admin: me.data, version, refresh }}>{children}</Context.Provider>;
}

export function useAdmin(): AdminProfile {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useAdmin outside AdminGate');
  return ctx.admin;
}

/** Reload admin data after a change (replaces router.refresh() of the server-rendered console) */
export function useAdminRefresh() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useAdminRefresh outside AdminGate');
  return ctx.refresh;
}

/** Loads admin data; reloads whenever useAdminRefresh() is called */
export function useAdminApi<T>(path: string | null) {
  const ctx = useContext(Context);
  return useApi<T>(path, 'admin', ctx?.version ?? 0);
}
