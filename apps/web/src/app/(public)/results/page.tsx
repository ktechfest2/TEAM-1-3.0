import type { Metadata } from 'next';
import { Suspense } from 'react';
import { parseUnitCode } from '@trustelect/shared';
import { UnitResultCard, type PublicUnitResult } from '@/components/unit-result-card';
import { UnitSearch } from '@/components/unit-search';

export const metadata: Metadata = { title: 'Results' };

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

type UnitResults = {
  unit: { code: string; name: string; wardName: string; lgaName: string; stateName: string };
  results: PublicUnitResult[];
};

async function lookUp(code: string): Promise<UnitResults | null | 'error'> {
  try {
    const res = await fetch(`${API_URL}/results/units/${code}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return 'error';
    return (await res.json()) as UnitResults;
  } catch {
    return 'error';
  }
}

async function UnitLookup({ searchParams }: { searchParams: PageProps<'/results'>['searchParams'] }) {
  const { unit } = await searchParams;
  const raw = typeof unit === 'string' ? unit.trim() : undefined;
  const parsed = raw ? parseUnitCode(raw) : null;
  const found = parsed ? await lookUp(parsed.unit) : undefined;

  return (
    <>
      <div className="max-w-xl">
        <UnitSearch defaultValue={raw} />
      </div>
      {raw && (
        <section aria-live="polite" className="mt-8 max-w-2xl">
          {!parsed ? (
            <p className="text-mismatch">
              <strong>{raw}</strong> is not a valid polling unit code. Use the format 24-05-01-003.
            </p>
          ) : found === 'error' ? (
            <p className="text-mismatch">TrustElect could not look this up right now. Please try again shortly.</p>
          ) : !found ? (
            <p>
              <strong className="tabular">{parsed.unit}</strong> is not in the polling unit register. Check the code on
              your voter&apos;s card or the result poster.
            </p>
          ) : (
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
          )}
        </section>
      )}
    </>
  );
}

export default function ResultsPage(props: PageProps<'/results'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Find a result</h1>
      <p className="mt-2 max-w-[60ch] text-ink-muted">
        Look up the citizen-collated result for any polling unit, with its witnesses and confidence.
      </p>
      <div className="mt-6">
        <Suspense fallback={<div className="max-w-xl"><UnitSearch /></div>}>
          <UnitLookup searchParams={props.searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
