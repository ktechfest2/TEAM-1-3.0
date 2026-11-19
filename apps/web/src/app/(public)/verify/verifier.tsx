'use client';

import { useState } from 'react';
import { apiUrl } from '@/lib/api-url';
import { verifyPack, type ChainEntry, type Check, type PublishedChain, type VerifyResult } from '@trustelect/shared';

const published: PublishedChain = {
  async entries(from) {
    const all: ChainEntry[] = [];
    for (;;) {
      const res = await fetch(apiUrl(`/chain/entries?from=${from}&limit=5000`), { cache: 'no-store' });
      if (!res.ok) throw new Error('chain unavailable');
      const page = (await res.json()) as ChainEntry[];
      all.push(...page);
      if (page.length < 5000) return all;
      from = page.at(-1)!.seq + 1;
    }
  },
  async anchors() {
    const res = await fetch(apiUrl('/chain/anchors?limit=500'), { cache: 'no-store' });
    if (!res.ok) throw new Error('anchors unavailable');
    return res.json();
  },
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const STATUS: Record<Check['status'], { label: string; cls: string }> = {
  pass: { label: 'Passed', cls: 'bg-match-bg text-match' },
  fail: { label: 'Failed', cls: 'bg-mismatch-bg text-mismatch' },
  warn: { label: 'Note', cls: 'bg-dispute-bg text-dispute' },
};

export function Verifier() {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function run(file: File) {
    setBusy(true);
    setResult(null);
    setFileName(file.name);
    try {
      setResult(await verifyPack(new Uint8Array(await file.arrayBuffer()), published));
    } catch (err) {
      setResult({ ok: false, manifest: null, checks: [{ status: 'fail', title: 'Check could not run', detail: (err as Error).message }] });
    } finally {
      setBusy(false);
    }
  }

  const failures = result?.checks.filter((c) => c.status === 'fail').length ?? 0;
  const m = result?.manifest;

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <label htmlFor="pack" className="font-semibold">Evidence pack (.zip)</label>
        <p id="pack-hint" className="text-sm text-ink-muted">
          The check runs in your browser. The pack is not uploaded; only the public chain is downloaded to compare against.
        </p>
        <input
          id="pack"
          type="file"
          accept=".zip,application/zip"
          aria-describedby="pack-hint"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void run(file);
          }}
          className="rounded-xl border border-dashed border-border bg-surface-muted p-4 text-sm file:mr-4 file:min-h-10 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:font-semibold file:text-brand-ink hover:file:bg-brand-strong"
        />
      </div>

      {busy && (
        <div className="grid gap-2">
          <p className="text-sm text-ink-muted">Checking {fileName}…</p>
          <progress aria-label="Checking the evidence pack" className="coverage-bar" />
        </div>
      )}

      {/* One polite region for the verdict only */}
      <div aria-live="polite" aria-atomic="true">
        {result && (
          <p
            className={`rounded-xl px-4 py-3 font-semibold ${failures ? 'bg-mismatch-bg text-mismatch' : 'bg-match-bg text-match'}`}
          >
            {failures
              ? `This pack does not match the published chain: ${failures} ${failures === 1 ? 'check' : 'checks'} failed.`
              : 'This pack matches the published chain. Nothing in it has been changed.'}
          </p>
        )}
      </div>

      {result && (
        <>
          {m && (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-ink-muted">Election</dt>
              <dd className="font-medium">{m.election.title}</dd>
              <dt className="text-ink-muted">{m.area.level === 'ward' ? 'Ward' : 'Polling unit'}</dt>
              <dd className="font-medium">
                {m.area.name} <span className="font-mono text-ink-muted">{m.area.code}</span>
              </dd>
              <dt className="text-ink-muted">Contents</dt>
              <dd>
                {[
                  count(m.records.filter((r) => r.entryType === 'unit_result').length, 'unit result', 'unit results'),
                  count(m.records.filter((r) => r.entryType === 'submission').length, 'accepted photo', 'accepted photos'),
                  count(m.records.filter((r) => r.entryType === 'declaration').length, 'declaration', 'declarations'),
                ].join(', ')}
              </dd>
              <dt className="text-ink-muted">Pack made</dt>
              <dd>{new Date(m.generatedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })}</dd>
            </dl>
          )}
          <ul className="grid gap-2" aria-label="Checks">
            {result.checks.map((c, i) => (
              <li key={i} className="grid gap-1 rounded-xl border border-divider bg-surface p-3 sm:grid-cols-[6rem_1fr] sm:items-start">
                <span className={`justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[c.status].cls}`}>
                  {STATUS[c.status].label}
                </span>
                <span>
                  <span className="font-medium">{c.title}</span>
                  <span className="block text-sm text-ink-muted [overflow-wrap:anywhere]">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
