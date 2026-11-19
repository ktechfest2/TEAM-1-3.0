'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { parseUnitCode } from '@trustelect/shared';
import { UnitResultCard, type PublicUnitResult } from '@/components/unit-result-card';
import { UnitSearch } from '@/components/unit-search';
import { useApi } from '@/lib/api';

type UnitResults = {
  unit: { code: string; name: string; wardName: string; lgaName: string; stateName: string };
  results: PublicUnitResult[];
};

type Match = {
  code: string;
  name: string;
  ward: { code: string; name: string };
  lga: { code: string; name: string };
  state: { code: string; name: string };
};

const SEARCH_LIMIT = 30;

/** Digits and separators only: meant as a code, so a typo gets the code message rather than a name search */
const looksLikeCode = (text: string) => /^[\d\s\-/.]+$/.test(text);

function UnitResult({ code }: { code: string }) {
  const q = useApi<UnitResults>(`/results/units/${code}`);
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error' && q.error.status !== 404) {
    return <p className="text-mismatch">TrustElect could not look this up right now. Please try again shortly.</p>;
  }
  if (q.status === 'error') {
    return (
      <p>
        <strong className="tabular">{code}</strong> is not in the polling unit register. Check the code on your voter&apos;s card or
        the result poster, or search by the polling unit&apos;s name or address.
      </p>
    );
  }
  const found = q.data;
  return (
    <>
      <p className="font-mono text-sm text-ink-muted tabular">{found.unit.code}</p>
      <h2 className="mt-1 text-xl font-semibold">{found.unit.name}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {found.unit.wardName} ward · {found.unit.lgaName} · {found.unit.stateName}
      </p>
      <div className="mt-5 grid gap-4">
        {found.results.length === 0 ? (
          <p className="text-ink-muted">No published election covers this polling unit yet.</p>
        ) : (
          found.results.map((r) => <UnitResultCard key={r.election.id} result={r} unitCode={found.unit.code} />)
        )}
      </div>
    </>
  );
}

function UnitMatches({ text }: { text: string }) {
  const q = useApi<Match[]>(`/geo/search?q=${encodeURIComponent(text)}&limit=${SEARCH_LIMIT}`);
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Searching…</p>;
  if (q.status === 'error') return <p className="text-mismatch">TrustElect could not search right now. Please try again shortly.</p>;
  if (!q.data.length) {
    return (
      <p>
        No polling unit matches <strong>{text}</strong>. Try fewer words, check the spelling, or use the code on your voter&apos;s
        card.
      </p>
    );
  }
  return (
    <>
      <h2 className="text-xl font-semibold">
        {q.data.length === SEARCH_LIMIT ? `First ${SEARCH_LIMIT} polling units` : `${q.data.length} polling unit${q.data.length === 1 ? '' : 's'}`}{' '}
        matching &ldquo;{text}&rdquo;
      </h2>
      {q.data.length === SEARCH_LIMIT && (
        <p className="mt-1 text-sm text-ink-muted">Add the ward, LGA or state to your search to narrow it down.</p>
      )}
      <ul className="mt-4 divide-y divide-divider rounded-2xl border border-divider bg-surface">
        {q.data.map((m) => (
          <li key={m.code}>
            <Link
              href={`/results?unit=${m.code}`}
              className="grid gap-0.5 px-5 py-3 no-underline hover:bg-surface-muted focus-visible:bg-surface-muted"
            >
              <span className="font-semibold text-ink">{m.name}</span>
              <span className="text-sm text-ink-muted">
                <span className="font-mono tabular">{m.code}</span> · {m.ward.name} ward · {m.lga.name} · {m.state.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function UnitLookup() {
  const raw = useSearchParams().get('unit')?.trim() || undefined;
  const parsed = raw ? parseUnitCode(raw) : null;

  return (
    <>
      <div className="max-w-xl">
        <UnitSearch key={raw} defaultValue={raw} />
      </div>
      {raw && (
        <section aria-live="polite" className="mt-8 max-w-2xl">
          {parsed ? (
            <UnitResult code={parsed.unit} />
          ) : looksLikeCode(raw) ? (
            <p className="text-mismatch">
              <strong>{raw}</strong> is not a valid polling unit code. Use the format 24-05-01-003, or search by the polling unit&apos;s
              name or address.
            </p>
          ) : raw.length < 2 ? (
            <p className="text-mismatch">Type at least two letters of the polling unit&apos;s name or address.</p>
          ) : (
            <UnitMatches text={raw} />
          )}
        </section>
      )}
    </>
  );
}
