'use client';

import { useAdminRefresh } from '@/lib/admin-session';
import { useState } from 'react';
import { FormError, inputClass } from '@/components/admin/auth-card';
import { adminPost } from '@/lib/admin-client';
import { apiUrl, authHeaders } from '@/lib/api';

type Election = { id: string; title: string; scopeLevel: string; scopeCode: string | null; parties: { acronym: string; name: string }[] };

const LEVELS = [
  ['national', 'National'],
  ['state', 'State'],
  ['lga', 'LGA'],
  ['ward', 'Ward'],
] as const;
const RANK: Record<string, number> = { national: 0, state: 1, lga: 2, ward: 3 };

type Prefill = { partyVotes: Record<string, number | null>; totalValid: number | null; rejected: number | null; totalCast: number | null; unmatchedParties: string[] };

export function RecordForm({ elections }: { elections: Election[] }) {
  const refresh = useAdminRefresh();
  const [electionId, setElectionId] = useState(elections[0]?.id ?? '');
  const election = elections.find((e) => e.id === electionId);
  const [level, setLevel] = useState<string>(election?.scopeLevel === 'polling_unit' ? 'ward' : (election?.scopeLevel ?? 'national'));
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [totals, setTotals] = useState({ totalValid: '', rejected: '', totalCast: '' });
  const [source, setSource] = useState<{ key: string; note: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [needsAck, setNeedsAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!election) return <p className="text-ink-muted">Make an election active first.</p>;
  const levels = LEVELS.filter(([l]) => RANK[l] >= RANK[election.scopeLevel === 'polling_unit' ? 'ward' : election.scopeLevel]);

  async function readSource(file: File) {
    setReading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/admin/declarations/source?electionId=${electionId}`), {
        method: 'POST',
        headers: { 'content-type': file.type, ...authHeaders('admin') },
        body: file,
      });
      const data = (await res.json()) as { sourceFileKey?: string; prefill?: Prefill | null; message?: string };
      if (!res.ok || !data.sourceFileKey) return setError(data.message ?? 'Could not upload the photo. Use a JPEG or WebP image.');
      const p = data.prefill;
      if (p) {
        setVotes(Object.fromEntries(Object.entries(p.partyVotes).map(([k, v]) => [k, v === null ? '' : String(v)])));
        setTotals({
          totalValid: p.totalValid?.toString() ?? '',
          rejected: p.rejected?.toString() ?? '',
          totalCast: p.totalCast?.toString() ?? '',
        });
      }
      setSource({
        key: data.sourceFileKey,
        note: p
          ? `Figures read by AI. Check every number against the document before saving.${p.unmatchedParties.length ? ` Not on this ballot: ${p.unmatchedParties.join(', ')}.` : ''}`
          : 'Photo attached. The AI could not read it; enter the figures by hand.',
      });
    } catch {
      setError('Could not upload the photo. Check your connection and try again.');
    } finally {
      setReading(false);
    }
  }

  return (
    <form
      method="post"
      aria-labelledby="record-heading"
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const d = new FormData(form);
        const num = (v: string) => (v.trim() === '' ? null : Number(v));
        setBusy(true);
        setError(null);
        const result = await adminPost('/admin/declarations', {
          electionId,
          level,
          areaCode: level === 'national' ? null : String(d.get('areaCode') ?? '').trim(),
          partyVotes: Object.fromEntries(election.parties.map((p) => [p.acronym, Number(votes[p.acronym] ?? '')])),
          totalValid: num(totals.totalValid),
          rejected: num(totals.rejected),
          totalCast: num(totals.totalCast),
          // Entered in Nigerian time (WAT, UTC+1)
          declaredAt: `${d.get('declaredAt')}:00+01:00`,
          sourceKind: d.get('sourceKind'),
          sourceUrl: String(d.get('sourceUrl') ?? '').trim() || undefined,
          sourceFileKey: source?.key,
          acknowledgeArithmetic: d.get('acknowledge') === 'on',
        });
        setBusy(false);
        if (!result.ok) {
          setNeedsAck(/add up to/.test(result.message));
          return setError(result.message);
        }
        form.reset();
        setVotes({});
        setTotals({ totalValid: '', rejected: '', totalCast: '' });
        setSource(null);
        setNeedsAck(false);
        refresh();
      }}
    >
      <h2 id="record-heading" className="text-lg font-semibold">Record a declaration</h2>

      <div className="grid gap-1.5">
        <label htmlFor="electionId" className="font-medium">Election</label>
        <select
          id="electionId"
          value={electionId}
          onChange={(e) => {
            setElectionId(e.target.value);
            setVotes({});
            setSource(null);
          }}
          className={inputClass}
        >
          {elections.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="level" className="font-medium">Level</label>
          <select id="level" value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
            {levels.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        {level !== 'national' && (
          <div className="grid gap-1.5">
            <label htmlFor="areaCode" className="font-medium">Area code</label>
            <input
              id="areaCode"
              name="areaCode"
              required
              placeholder={{ state: '24', lga: '24-05', ward: '24-05-01' }[level]}
              defaultValue={election.scopeLevel === level ? (election.scopeCode ?? '') : ''}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} tabular`}
            />
          </div>
        )}
      </div>

      <fieldset className="grid gap-3 rounded-xl border border-divider p-4">
        <legend className="px-1 font-medium">Source</legend>
        <div className="grid gap-1.5">
          <label htmlFor="sourceKind" className="text-sm font-medium">Type</label>
          <select id="sourceKind" name="sourceKind" className={inputClass}>
            <option value="collation_result_photo">Photo of the collation result sheet</option>
            <option value="inec_statement">Official INEC statement</option>
            <option value="broadcast">Official broadcast</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="sourceUrl" className="text-sm font-medium">Link (https)</label>
          <input id="sourceUrl" name="sourceUrl" type="url" inputMode="url" placeholder="https://" className={inputClass} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="sourcePhoto" className="text-sm font-medium">Photo of the document</label>
          <p id="photo-hint" className="text-sm text-ink-muted">JPEG or WebP. TrustElect stores it with its fingerprint and can read the figures for you.</p>
          <input
            id="sourcePhoto"
            type="file"
            accept="image/jpeg,image/webp"
            aria-describedby="photo-hint"
            disabled={reading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readSource(file);
            }}
            className="text-sm"
          />
          {reading && <p role="status" className="text-sm text-ink-muted">Uploading and reading the figures…</p>}
          {source && <p role="status" className="rounded-lg bg-dispute-bg px-3 py-2 text-sm text-dispute">{source.note}</p>}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium">Declared votes</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {election.parties.map((p) => (
            <div key={p.acronym} className="grid gap-1">
              <label htmlFor={`v-${p.acronym}`} className="text-sm">
                <span className="font-semibold">{p.acronym}</span> <span className="text-ink-muted">{p.name}</span>
              </label>
              <input
                id={`v-${p.acronym}`}
                type="text"
                inputMode="numeric"
                pattern="\d+"
                required
                value={votes[p.acronym] ?? ''}
                onChange={(e) => setVotes((v) => ({ ...v, [p.acronym]: e.target.value.replace(/[^\d]/g, '') }))}
                className={`${inputClass} tabular`}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['totalValid', 'Total valid votes'],
              ['rejected', 'Rejected votes'],
              ['totalCast', 'Total votes cast'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="grid gap-1">
              <label htmlFor={key} className="text-sm">{label} <span className="text-ink-muted">(if shown)</span></label>
              <input
                id={key}
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={totals[key]}
                onChange={(e) => setTotals((t) => ({ ...t, [key]: e.target.value.replace(/[^\d]/g, '') }))}
                className={`${inputClass} tabular`}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="declaredAt" className="font-medium">Declared at (Nigerian time)</label>
        <input id="declaredAt" name="declaredAt" type="datetime-local" required className={inputClass} />
      </div>

      {needsAck && (
        <label className="flex items-start gap-2 rounded-xl border border-dispute bg-dispute-bg p-3 text-sm text-dispute">
          <input type="checkbox" name="acknowledge" className="mt-0.5 size-4" />
          The declaration really shows these figures, even though they do not add up. Record them as declared.
        </label>
      )}

      <FormError message={error} />
      <button
        type="submit"
        disabled={busy || reading}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70"
      >
        {busy ? 'Saving…' : 'Save for approval'}
      </button>
      <p className="text-sm text-ink-muted">A second administrator must approve it before it is published or compared.</p>
    </form>
  );
}
