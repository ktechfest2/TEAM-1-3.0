'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NIGERIAN_STATES } from '@trustelect/shared';
import { FormError, inputClass } from '@/components/admin/auth-card';
import { adminPost } from '@/lib/admin-client';
import { ELECTION_TYPE_LABELS } from './labels';

type Party = { acronym: string; name: string };
type Scope = 'national' | 'state' | 'lga';

export function CreateElectionForm({ parties }: { parties: Party[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('national');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // INEC lists parties on the ballot in alphabetical order of acronym
  const ballot = useMemo(() => [...selected].sort((a, b) => a.localeCompare(b, 'en')), [selected]);

  return (
    <form
      method="post"
      aria-labelledby="create-election-heading"
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const d = new FormData(form);
        const date = String(d.get('electionDate'));
        setBusy(true);
        setError(null);
        const result = await adminPost<{ id: string }>('/admin/elections', {
          type: d.get('type'),
          title: d.get('title'),
          electionDate: date,
          scopeLevel: scope,
          scopeCode: scope === 'national' ? undefined : String(d.get('scopeCode') ?? '').trim(),
          // Polls close time is entered in Nigerian time (WAT, UTC+1)
          pollsCloseAt: `${date}T${d.get('pollsClose')}:00+01:00`,
          partyAcronyms: ballot,
        });
        setBusy(false);
        if (!result.ok) return setError(result.message);
        form.reset();
        setSelected([]);
        setScope('national');
        router.refresh();
      }}
    >
      <h2 id="create-election-heading" className="text-lg font-semibold">
        Create an election
      </h2>

      <div className="grid gap-1.5">
        <label htmlFor="type" className="font-medium">Type</label>
        <select id="type" name="type" required className={inputClass}>
          {Object.entries(ELECTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="title" className="font-medium">Title</label>
        <input id="title" name="title" required minLength={5} maxLength={160} autoComplete="off" className={inputClass} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="electionDate" className="font-medium">Election date</label>
          <input id="electionDate" name="electionDate" type="date" required className={inputClass} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pollsClose" className="font-medium">Polls close (Nigerian time)</label>
          <input id="pollsClose" name="pollsClose" type="time" required defaultValue="14:30" className={inputClass} />
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">Area covered</legend>
        {(['national', 'state', 'lga'] as const).map((s) => (
          <label key={s} className="flex items-center gap-2">
            <input type="radio" name="scope" value={s} checked={scope === s} onChange={() => setScope(s)} className="size-4" />
            {s === 'national' ? 'Whole country' : s === 'state' ? 'One state' : 'One LGA'}
          </label>
        ))}
      </fieldset>

      {scope === 'state' && (
        <div className="grid gap-1.5">
          <label htmlFor="scopeCode" className="font-medium">State</label>
          <select id="scopeCode" name="scopeCode" required className={inputClass}>
            {NIGERIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      {scope === 'lga' && (
        <div className="grid gap-1.5">
          <label htmlFor="scopeCode" className="font-medium">LGA code</label>
          <p id="lga-hint" className="text-sm text-ink-muted">State and LGA, for example 24-05. See the Polling units page.</p>
          <input
            id="scopeCode"
            name="scopeCode"
            required
            pattern="\d{2}-\d{2}"
            aria-describedby="lga-hint"
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            className={inputClass}
          />
        </div>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">Parties on the ballot</legend>
        {parties.length === 0 ? (
          <p className="text-sm text-ink-muted">Add parties on the Parties page first.</p>
        ) : (
          <div className="grid max-h-64 gap-1.5 overflow-auto rounded-xl border border-divider p-3">
            {parties.map((p) => (
              <label key={p.acronym} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  value={p.acronym}
                  checked={selected.includes(p.acronym)}
                  onChange={(e) =>
                    setSelected((cur) => (e.target.checked ? [...cur, p.acronym] : cur.filter((a) => a !== p.acronym)))
                  }
                  className="mt-1 size-4"
                />
                <span>
                  <span className="font-semibold">{p.acronym}</span> <span className="text-ink-muted">{p.name}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {ballot.length > 0 && (
          <p className="text-sm text-ink-muted">
            Ballot order (alphabetical, as on INEC ballots): <span className="font-medium text-ink">{ballot.join(', ')}</span>
          </p>
        )}
      </fieldset>

      <FormError message={error} />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70"
      >
        {busy ? 'Creating…' : 'Create as draft'}
      </button>
      <p className="text-sm text-ink-muted">New elections start as drafts and are hidden from the public until made active.</p>
    </form>
  );
}
