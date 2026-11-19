'use client';

import { useSearchParams } from 'next/navigation';
import { parseUnitCode } from '@trustelect/shared';
import { UnitResultCard, type PublicUnitResult } from '@/components/unit-result-card';
import { UnitSearch } from '@/components/unit-search';
import { useApi } from '@/lib/api';

type UnitResults = {
  unit: { code: string; name: string; wardName: string; lgaName: string; stateName: string };
  results: PublicUnitResult[];
};

export function UnitLookup() {
  const raw = useSearchParams().get('unit')?.trim() || undefined;
  const parsed = raw ? parseUnitCode(raw) : null;
  const q = useApi<UnitResults>(parsed ? `/results/units/${parsed.unit}` : null);
  const found = q.status === 'ready' ? q.data : q.status === 'error' ? (q.error.status === 404 ? null : 'error') : undefined;

  return (
    <>
      <div className="max-w-xl">
        <UnitSearch defaultValue={raw} />
      </div>
      {raw && (
        <section aria-live="polite" className="mt-8 max-w-2xl">
          {parsed && q.status === 'loading' ? (
            <p role="status" className="text-ink-muted">Loading…</p>
          ) : !parsed ? (
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
