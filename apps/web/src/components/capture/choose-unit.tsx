'use client';

import { apiUrl } from '@/lib/api-url';
import { useState } from 'react';
import { parseUnitCode } from '@trustelect/shared';
import { FormError, inputClass, primaryButtonClass } from '@/components/admin/auth-card';

export type ChosenUnit = { code: string; name: string; ward: string; lga: string; state: string };

type Scope = { scopeLevel: string; scopeCode: string | null };

type UnitResponse = {
  code: string;
  name: string;
  ward: { code: string; name: string };
  lga: { code: string; name: string };
  state: { code: string; name: string };
};

function inScope(u: UnitResponse, e: Scope) {
  switch (e.scopeLevel) {
    case 'national':
      return true;
    case 'state':
      return u.state.code === e.scopeCode;
    case 'lga':
      return u.lga.code === e.scopeCode;
    case 'ward':
      return u.ward.code === e.scopeCode;
    default:
      return u.code === e.scopeCode;
  }
}

/** The voter's polling unit (from their voter's card), confirmed by name before the camera opens. */
export function ChooseUnit({
  election,
  initial,
  onChosen,
}: {
  election: Scope;
  initial: ChosenUnit | null;
  onChosen: (unit: ChosenUnit) => void;
}) {
  const [found, setFound] = useState<ChosenUnit | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<UnitResponse[] | null>(null);

  const choose = (u: UnitResponse) => setFound({ code: u.code, name: u.name, ward: u.ward.name, lga: u.lga.name, state: u.state.name });

  /** Name or address search, limited to the election's area */
  async function search(text: string) {
    if (text.trim().length < 2) return setError('Type the polling unit code, or at least two letters of its name or address.');
    setBusy(true);
    try {
      const stateCode = election.scopeLevel === 'national' ? null : election.scopeCode?.slice(0, 2);
      const res = await fetch(apiUrl(`/geo/search?q=${encodeURIComponent(text)}&limit=30${stateCode ? `&state=${stateCode}` : ''}`));
      if (!res.ok) return setError('Could not search right now. Check your connection and try again.');
      const list = ((await res.json()) as UnitResponse[]).filter((u) => inScope(u, election));
      if (!list.length) return setError(`No polling unit in this election's area matches "${text}". Try fewer words, or the code on your voter's card.`);
      if (list.length === 1) return choose(list[0]);
      setMatches(list);
    } catch {
      setError('Could not search right now. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function lookUp(raw: string) {
    setError(null);
    setFound(null);
    setMatches(null);
    const parsed = parseUnitCode(raw);
    if (!parsed) {
      // Digits and separators only: a mistyped code; anything else is a name or address
      if (/^[\d\s\-/.]+$/.test(raw.trim())) return setError('Enter the code in the format 24-05-01-003 (slashes are fine too).');
      return search(raw);
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/geo/units/${parsed.unit}`));
      if (res.status === 404) return setError(`${parsed.unit} is not in INEC's register. Check the code on your voter's card.`);
      if (!res.ok) return setError('Could not look up the code. Check your connection and try again.');
      const u = (await res.json()) as UnitResponse;
      if (!inScope(u, election)) {
        return setError(`${u.code} (${u.name}, ${u.state.name}) is not part of this election's area. Check you chose the right election.`);
      }
      choose(u);
    } catch {
      setError('Could not look up the code. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <form
        method="get"
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookUp(String(new FormData(e.currentTarget).get('unit') ?? ''));
        }}
      >
        <label htmlFor="unit" className="font-semibold">Polling unit code or name</label>
        <p id="unit-hint" className="text-sm text-ink-muted">
          The code is printed on your voter&apos;s card, for example <span className="whitespace-nowrap">24-05-01-003</span>. You can
          also type the polling unit&apos;s name or address.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            id="unit"
            name="unit"
            type="text"
            required
            defaultValue={initial?.code}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="unit-hint"
            enterKeyHint="search"
            className={`${inputClass} min-w-0 flex-1 basis-40 tabular`}
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 rounded-xl border border-border bg-surface px-4 font-semibold hover:bg-surface-muted disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Find'}
          </button>
        </div>
      </form>

      <FormError message={error} />

      {matches && !found && (
        <div className="grid gap-2" aria-live="polite">
          <p className="text-sm font-semibold">
            {matches.length === 30 ? 'First 30 matches. Add the ward or LGA to narrow it down.' : `${matches.length} polling units match. Choose yours:`}
          </p>
          <ul className="divide-y divide-divider rounded-xl border border-divider bg-surface">
            {matches.map((u) => (
              <li key={u.code}>
                <button type="button" onClick={() => choose(u)} className="grid w-full gap-0.5 px-4 py-3 text-left hover:bg-surface-muted focus-visible:bg-surface-muted">
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-sm text-ink-muted">
                    <span className="font-mono tabular">{u.code}</span> · {u.ward.name} ward · {u.lga.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {found && (
        <div className="grid gap-3 rounded-xl border-2 border-brand bg-surface-tint p-4" aria-live="polite">
          <div>
            <p className="font-mono text-sm text-ink-muted tabular">{found.code}</p>
            <p className="text-lg font-semibold">{found.name}</p>
            <p className="text-sm text-ink-muted">
              {found.ward} ward · {found.lga} · {found.state}
            </p>
          </div>
          <button type="button" className={primaryButtonClass} onClick={() => onChosen(found)}>
            Yes, this is my polling unit
          </button>
        </div>
      )}
    </div>
  );
}
