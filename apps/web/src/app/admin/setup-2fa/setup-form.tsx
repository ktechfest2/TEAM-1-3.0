'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormError, inputClass, primaryButtonClass } from '@/components/admin/auth-card';
import { QrCode } from '@/components/admin/qr-code';
import { apiUrl, authHeaders, sessionToken } from '@/lib/api';

type Setup = { secret: string; uri: string };

/** Groups the secret into blocks of four so it can be typed by hand. */
function formatSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

export function SetupForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(apiUrl('/admin/auth/totp/setup'), { method: 'POST', headers: authHeaders('admin') }).catch(() => null);
      if (cancelled) return;
      if (!res) return setError('Could not reach TrustElect. Reload the page to try again.');
      if (res.status === 401) {
        sessionToken.clear('admin');
        return router.replace('/admin/login');
      }
      if (res.status === 400) return router.replace('/admin');
      if (!res.ok) return setError('Could not start two-factor setup. Reload the page to try again.');
      setSetup((await res.json()) as Setup);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function confirm(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/admin/auth/totp/confirm'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders('admin') },
        body: JSON.stringify({ code }),
      });
      if (res.ok) return router.replace('/admin');
      if (res.status === 429) return setError('Too many attempts. Wait a minute and try again.');
      if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        if (data.message === 'Incorrect code') {
          return setError('That code is not correct. Check the time on your phone and try the newest code.');
        }
        return router.replace('/admin/login');
      }
      setError('Could not confirm the code. Try again.');
    } catch {
      setError('Could not reach TrustElect. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className="grid gap-4">
        <FormError message={error} />
        {!error && <p className="text-ink-muted" role="status">Preparing your QR code…</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <ol className="grid gap-5">
        <li className="grid gap-3">
          <p>
            <span className="font-semibold">1. Scan this QR code</span> with an authenticator app
            such as Google Authenticator, Microsoft Authenticator or Authy.
          </p>
          <div className="flex justify-center">
            <QrCode value={setup.uri} label="QR code for your authenticator app" />
          </div>
          <details className="rounded-xl bg-surface-muted px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">Can&apos;t scan it? Enter this key instead</summary>
            <p className="mt-2 break-all font-mono text-base tracking-wide select-all tabular">
              {formatSecret(setup.secret)}
            </p>
          </details>
        </li>
        <li>
          <form
            method="post"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm(String(new FormData(e.currentTarget).get('code') ?? '').trim());
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor="code" className="font-semibold">
                2. Enter the 6-digit code from the app
              </label>
              <p id="code-hint" className="text-sm text-ink-muted">
                The code changes every 30 seconds.
              </p>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                enterKeyHint="done"
                aria-describedby="code-hint"
                className={`${inputClass} font-mono tracking-[0.35em] tabular`}
              />
            </div>
            <FormError message={error} />
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {busy ? 'Confirming…' : 'Confirm and continue'}
            </button>
          </form>
        </li>
      </ol>
    </div>
  );
}
