'use client';

import { useState } from 'react';
import { publicPost } from '@/lib/admin-client';

type Issued = { id: string; key: string; keyPrefix: string; status: string };

const field = 'min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-base';

export function RegisterForm() {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (issued) {
    return (
      <div className="grid gap-4" role="status">
        <h3 className="text-lg font-semibold">Registration received</h3>
        <p>
          This is your API key. <strong>Copy it now and keep it secret: it is shown only once.</strong> TrustElect stores only a
          fingerprint of it and cannot show it again.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-xl bg-[#0f1b2d] px-4 py-3 font-mono text-sm break-all text-[#e6edf3]">{issued.key}</code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.key);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="min-h-12 rounded-xl border border-border px-4 font-semibold hover:bg-surface-muted"
          >
            {copied ? 'Copied' : 'Copy key'}
          </button>
        </div>
        <p className="text-ink-muted">
          The key starts working once TrustElect approves your registration. Until then, requests with it return 403 &ldquo;waiting
          for approval&rdquo;. Send it in the <code className="font-mono text-sm">X-API-Key</code> header from your server, never from a
          web page or app your users can inspect.
        </p>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const f = new FormData(e.currentTarget);
        const website = String(f.get('website') ?? '').trim();
        setBusy(true);
        const r = await publicPost<Issued>('/developers/register', {
          organisation: f.get('organisation'),
          contactName: f.get('contactName'),
          email: f.get('email'),
          website: website || null,
          purpose: f.get('purpose'),
          acceptTerms: f.get('acceptTerms') === 'on',
        });
        setBusy(false);
        if (!r.ok) return setError(r.message);
        setIssued(r.data);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="organisation" className="font-semibold">Organisation</label>
          <input id="organisation" name="organisation" required minLength={2} maxLength={120} autoComplete="organization" className={field} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="contactName" className="font-semibold">Your name</label>
          <input id="contactName" name="contactName" required minLength={2} maxLength={120} autoComplete="name" className={field} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="email" className="font-semibold">Work email</label>
          <input id="email" name="email" type="email" required maxLength={200} autoComplete="email" className={field} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="website" className="font-semibold">
            Website <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input id="website" name="website" type="url" maxLength={300} placeholder="https://" autoComplete="url" className={field} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="purpose" className="font-semibold">How will you use the data?</label>
        <textarea
          id="purpose"
          name="purpose"
          required
          minLength={20}
          maxLength={1000}
          rows={3}
          aria-describedby="purpose-hint"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-base"
        />
        <p id="purpose-hint" className="text-sm text-ink-muted">For example: live results on our news site, research on election transparency.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="acceptTerms" required className="mt-1 size-5 accent-[var(--brand)]" />
        <span>I accept the terms of use below, including labelling every figure as citizen-collated and unofficial.</span>
      </label>
      {error && (
        <p role="alert" className="text-mismatch">
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-60"
        >
          {busy ? 'Registering…' : 'Register for an API key'}
        </button>
      </div>
    </form>
  );
}
