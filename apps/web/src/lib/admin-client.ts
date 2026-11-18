/** Browser-side calls to the admin API through the same-origin /api proxy. */
export async function adminPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, status: res.status, message: describeError(res.status, data) };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach TrustElect. Check your connection and try again.' };
  }
}

function describeError(status: number, data: { message?: unknown; issues?: { path: string; message: string }[] }) {
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 403) return 'Your role does not allow this action.';
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (data.issues?.length) return data.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('. ');
  if (typeof data.message === 'string') return data.message;
  return 'Something went wrong. Try again.';
}
