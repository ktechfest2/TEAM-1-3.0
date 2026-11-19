'use client';

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

  async function lookUp(raw: string) {
    setError(null);
    setFound(null);
    const parsed = parseUnitCode(raw);
    if (!parsed) return setError('Enter the code in the format 24-05-01-003 (slashes are fine too).');
    setBusy(true);
    try {
      const res = await fetch(`/api/geo/units/${parsed.unit}`);
      if (res.status === 404) return setError(`${parsed.unit} is not in INEC's register. Check the code on your voter's card.`);
      if (!res.ok) return setError('Could not look up the code. Check your connection and try again.');
      const u = (await res.json()) as UnitResponse;
      if (!inScope(u, election)) {
        return setError(`${u.code} (${u.name}, ${u.state.name}) is not part of this election's area. Check you chose the right election.`);
      }
      setFound({ code: u.code, name: u.name, ward: u.ward.name, lga: u.lga.name, state: u.state.name });
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
        <label htmlFor="unit" className="font-semibold">Polling unit code</label>
        <p id="unit-hint" className="text-sm text-ink-muted">
          It is printed on your voter&apos;s card, for example <span className="whitespace-nowrap">24-05-01-003</span>.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            id="unit"
            name="unit"
            type="text"
            inputMode="numeric"
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
