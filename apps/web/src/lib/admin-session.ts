import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const SESSION_COOKIE = 'te_admin';

export type AdminRole = 'reviewer' | 'declarations_admin' | 'approver' | 'system_admin';

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  mfaVerified: boolean;
}

/** Asks the API who owns the session cookie. Null if there is no valid session. */
async function fetchAdmin(): Promise<AdminProfile | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API_URL}/admin/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as AdminProfile;
}

/**
 * Data access layer for the admin console: returns the signed-in administrator,
 * or redirects to sign-in (no session) or two-factor setup (password only).
 * Every admin page and action must call this; hiding links is not protection.
 */
export async function requireAdmin(): Promise<AdminProfile> {
  const admin = await fetchAdmin();
  if (!admin) redirect('/admin/login');
  if (!admin.mfaVerified) redirect('/admin/setup-2fa');
  return admin;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  reviewer: 'Reviewer',
  declarations_admin: 'Declarations administrator',
  approver: 'Approver',
  system_admin: 'System administrator',
};
