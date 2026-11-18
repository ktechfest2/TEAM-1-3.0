'use client';

import { useState } from 'react';
import { FormError, inputClass, primaryButtonClass } from '@/components/admin/auth-card';
import { apiPost } from '@/lib/admin-client';

/** Default flow: the voter's phone number, no SMS code. Consent was given on the previous step. */
export function EnterPhone({ onStarted }: { onStarted: (phoneMasked: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      method="post"
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const phone = String(new FormData(e.currentTarget).get('phone') ?? '');
        setBusy(true);
        setError(null);
        const result = await apiPost<{ phoneMasked: string }>('/capture/start', { phone, consent: true });
        setBusy(false);
        if (!result.ok) return setError(result.message);
        onStarted(result.data.phoneMasked);
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="phone" className="font-semibold">Mobile number</label>
        <p id="phone-hint" className="text-sm text-ink-muted">
          Each number counts as one witness. It is stored encrypted and never shown publicly.
        </p>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="0803 123 4567"
          aria-describedby="phone-hint"
          enterKeyHint="go"
          className={`${inputClass} tabular`}
        />
      </div>
      <FormError message={error} />
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? 'Starting…' : 'Continue to camera'}
      </button>
    </form>
  );
}
