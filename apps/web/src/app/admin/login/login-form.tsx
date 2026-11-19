'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormError, inputClass, primaryButtonClass } from '@/components/admin/auth-card';
import { apiUrl, sessionToken } from '@/lib/api';

type Step = 'credentials' | 'code';

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const credentials = useRef<{ email: string; password: string } | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  async function submit(body: { email: string; password: string; code?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/admin/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string; token?: string };
      if (data.token) sessionToken.set('admin', data.token);

      if (res.status === 429) return setError('Too many attempts. Wait a minute and try again.');
      if (!res.ok) return setError(data.message ?? 'Sign-in failed. Try again.');

      switch (data.status) {
        case 'ok':
          router.replace('/admin');
          return;
        case 'totp_setup_required':
          router.replace('/admin/setup-2fa');
          return;
        case 'totp_required':
          credentials.current = { email: body.email, password: body.password };
          setStep('code');
          requestAnimationFrame(() => codeInput.current?.focus());
          return;
        default:
          setError('Sign-in failed. Try again.');
      }
    } catch {
      setError('Could not reach TrustElect. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code') {
    return (
      <form
        method="post"
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
          if (credentials.current) void submit({ ...credentials.current, code });
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor="code" className="font-semibold">
            Authentication code
          </label>
          <p id="code-hint" className="text-sm text-ink-muted">
            Open your authenticator app and enter the 6-digit code for TrustElect.
          </p>
          <input
            ref={codeInput}
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
          {busy ? 'Verifying…' : 'Verify and sign in'}
        </button>
        <button
          type="button"
          className="text-sm font-medium text-brand-strong underline-offset-4 hover:underline"
          onClick={() => {
            credentials.current = null;
            setError(null);
            setStep('credentials');
          }}
        >
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form
      method="post"
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void submit({
          email: String(form.get('email') ?? '').trim(),
          password: String(form.get('password') ?? ''),
        });
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="email" className="font-semibold">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          enterKeyHint="next"
          className={inputClass}
        />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="font-semibold">
            Password
          </label>
          <button
            type="button"
            aria-pressed={showPassword}
            aria-controls="password"
            onClick={() => setShowPassword((v) => !v)}
            className="rounded px-1 text-sm font-medium text-brand-strong hover:underline"
          >
            {showPassword ? 'Hide password' : 'Show password'}
          </button>
        </div>
        <input
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          enterKeyHint="done"
          className={inputClass}
        />
      </div>
      <FormError message={error} />
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
