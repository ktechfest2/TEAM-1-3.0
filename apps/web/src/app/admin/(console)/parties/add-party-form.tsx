'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormError, inputClass } from '@/components/admin/auth-card';
import { adminPost } from '@/lib/admin-client';

export function AddPartyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      method="post"
      className="grid gap-4"
      aria-labelledby="add-party-heading"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        setError(null);
        const result = await adminPost('/admin/parties', {
          acronym: String(data.get('acronym') ?? ''),
          name: String(data.get('name') ?? ''),
        });
        setBusy(false);
        if (!result.ok) return setError(result.message);
        form.reset();
        router.refresh();
      }}
    >
      <h2 id="add-party-heading" className="text-lg font-semibold">
        Add a party
      </h2>
      <div className="grid gap-1.5">
        <label htmlFor="acronym" className="font-medium">
          Acronym
        </label>
        <input
          id="acronym"
          name="acronym"
          required
          minLength={2}
          maxLength={10}
          pattern="[A-Za-z][A-Za-z0-9\-]{1,9}"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} uppercase`}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="name" className="font-medium">
          Full name
        </label>
        <input id="name" name="name" required minLength={3} maxLength={120} autoComplete="off" className={inputClass} />
      </div>
      <FormError message={error} />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70"
      >
        {busy ? 'Adding…' : 'Add party'}
      </button>
      <p className="text-sm text-ink-muted">Use the party&apos;s registered name and acronym exactly as INEC lists them.</p>
    </form>
  );
}
