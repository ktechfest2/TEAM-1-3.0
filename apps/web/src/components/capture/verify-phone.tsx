'use client';

import { useEffect, useRef, useState } from 'react';
import { FormError, inputClass, primaryButtonClass } from '@/components/admin/auth-card';
import { apiPost } from '@/lib/admin-client';

/** Phone number, then the 6-digit SMS code (CAP-02). Consent was given on the previous step. */
export function VerifyPhone({ onVerified }: { onVerified: (phoneMasked: string) => void }) {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<{ phoneMasked: string; devCode?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeForm = useRef<HTMLFormElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Let supporting phones read the SMS code automatically (WebOTP), with manual entry as fallback
  useEffect(() => {
    if (!sent || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((otp) => {
        const code = (otp as unknown as { code?: string } | null)?.code;
        if (code && codeInput.current) {
          codeInput.current.value = code;
          codeForm.current?.requestSubmit();
        }
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [sent]);

  async function requestCode() {
    setBusy(true);
    setError(null);
    const result = await apiPost<{ phoneMasked: string; devCode?: string }>('/capture/code', { phone });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSent(result.data);
    requestAnimationFrame(() => codeInput.current?.focus());
  }

  if (!sent) {
    return (
      <form
        key="phone"
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void requestCode();
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor="phone" className="font-semibold">Your mobile number</label>
          <p id="phone-hint" className="text-sm text-ink-muted">
            We send a code to check the number is real. It is never shown publicly and each number counts as one witness.
          </p>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0803 123 4567"
            aria-describedby="phone-hint"
            enterKeyHint="send"
            className={`${inputClass} tabular`}
          />
        </div>
        <FormError message={error} />
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Sending…' : 'Send code'}
        </button>
      </form>
    );
  }

  return (
    <form
      key="code"
      ref={codeForm}
      method="post"
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
        setBusy(true);
        setError(null);
        const result = await apiPost<{ phoneMasked: string }>('/capture/verify', { phone, code, consent: true });
        setBusy(false);
        if (!result.ok) return setError(result.message);
        onVerified(result.data.phoneMasked);
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="code" className="font-semibold">Code sent to {sent.phoneMasked}</label>
        <p id="code-hint" className="text-sm text-ink-muted">Enter the 6-digit code from the SMS. It expires in 10 minutes.</p>
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
          aria-describedby="code-hint"
          enterKeyHint="done"
          className={`${inputClass} font-mono tracking-[0.35em] tabular`}
        />
      </div>
      {sent.devCode && (
        <p className="rounded-xl border border-dispute bg-dispute-bg px-3 py-2 text-sm text-dispute">
          Development mode: no SMS is sent. Your code is <strong className="font-mono">{sent.devCode}</strong>.
        </p>
      )}
      <FormError message={error} />
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? 'Checking…' : 'Verify'}
      </button>
      <button
        type="button"
        onClick={() => {
          setSent(null);
          setError(null);
        }}
        className="text-sm font-medium text-brand-strong hover:underline"
      >
        Use a different number
      </button>
    </form>
  );
}
