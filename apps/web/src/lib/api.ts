'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The web app is a static site (trustelect.web.app); it calls the TrustElect API on its own
 * address. Browsers block cookies set by another site, so sessions travel as Bearer tokens.
 */
import { apiUrl } from './api-url';

export { API_URL, apiUrl } from './api-url';

type Who = 'admin' | 'voter';

/**
 * Admin tokens live for the browser tab only (sessionStorage); voter tokens survive a restart
 * of the capture app (localStorage) so queued photos can still be sent.
 */
const KEYS: Record<Who, { key: string; store: () => Storage }> = {
  admin: { key: 'te_admin_token', store: () => sessionStorage },
  voter: { key: 'te_capture_token', store: () => localStorage },
};

export const sessionToken = {
  get(who: Who): string | null {
    try {
      return KEYS[who].store().getItem(KEYS[who].key);
    } catch {
      return null;
    }
  },
  set(who: Who, token: string) {
    try {
      KEYS[who].store().setItem(KEYS[who].key, token);
    } catch {
      /* private mode: the session lasts until the page closes */
    }
  },
  clear(who: Who) {
    try {
      KEYS[who].store().removeItem(KEYS[who].key);
    } catch {
      /* nothing stored */
    }
  },
};

export function authHeaders(who?: Who): Record<string, string> {
  const token = who ? sessionToken.get(who) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** GET as JSON; throws ApiError on failure (status 0 when the API cannot be reached). */
export async function apiGet<T>(path: string, who?: Who): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { headers: authHeaders(who), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Could not reach TrustElect. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, describeError(res.status, data));
  return data as T;
}

export type PostResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function apiPost<T = unknown>(path: string, body: unknown, who?: Who): Promise<PostResult<T>> {
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(who) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, status: res.status, message: describeError(res.status, data) };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach TrustElect. Check your connection and try again.' };
  }
}

/** Fetches a protected file (e.g. an evidence photo) and returns an object URL for it. */
export async function apiBlobUrl(path: string, who: Who): Promise<string> {
  const res = await fetch(apiUrl(path), { headers: authHeaders(who), cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status, 'Could not load the file.');
  return URL.createObjectURL(await res.blob());
}

const GENERIC = new Set(['Unauthorized', 'Forbidden resource', 'Forbidden', 'Bad Request', 'Invalid request']);

export function describeError(status: number, data: { message?: unknown; issues?: { path: string; message: string }[] }) {
  const own = typeof data.message === 'string' && !GENERIC.has(data.message) ? data.message : null;
  if (status === 401) return own ?? 'Your session has ended. Sign in again.';
  if (status === 403) return own ?? 'You are not allowed to do this.';
  if (status === 404) return own ?? 'Not found.';
  if (status === 429) return own && !own.startsWith('ThrottlerException') ? own : 'Too many requests. Wait a minute and try again.';
  if (data.issues?.length) return data.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('. ');
  if (typeof data.message === 'string') return data.message;
  return 'Something went wrong. Try again.';
}

export type Loaded<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: ApiError };

/**
 * Loads `path` (null = nothing to load) and reloads on `reload()`. Keeps the previous data
 * visible while reloading the same path, so live pages do not flash.
 */
export function useApi<T>(path: string | null, who?: Who, version = 0): Loaded<T> & { reload: () => void } {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: ApiError }>({ path: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    apiGet<T>(path, who).then(
      (data) => live && setState({ path, data }),
      (error: ApiError) => live && setState({ path, error }),
    );
    return () => {
      live = false;
    };
  }, [path, who, tick, version]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  if (!path || state.path !== path) return { status: 'loading', reload };
  if (state.error) return { status: 'error', error: state.error, reload };
  return { status: 'ready', data: state.data as T, reload };
}
