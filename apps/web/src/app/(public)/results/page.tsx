import type { Metadata } from 'next';
import { Suspense } from 'react';
import { parseUnitCode } from '@trustelect/shared';
import { UnitStatusBadge } from '@/components/status-badge';
import { UnitSearch } from '@/components/unit-search';

export const metadata: Metadata = { title: 'Results' };

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

type Unit = {
  code: string;
  name: string;
  registeredVoters: number | null;
  ward: { code: string; name: string };
  lga: { code: string; name: string };
  state: { code: string; name: string };
};

async function lookUp(code: string): Promise<Unit | null | 'error'> {
  try {
    const res = await fetch(`${API_URL}/geo/units/${code}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return 'error';
    return (await res.json()) as Unit;
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
        <section aria-live="polite" className="mt-8 max-w-2xl rounded-2xl border border-divider bg-surface p-5 sm:p-6">
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
              <p className="font-mono text-sm text-ink-muted tabular">{found.code}</p>
              <h2 className="mt-1 text-xl font-semibold">{found.name}</h2>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ink-muted">Ward</dt>
                  <dd className="font-medium">{found.ward.name}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">LGA</dt>
                  <dd className="font-medium">{found.lga.name}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">State</dt>
                  <dd className="font-medium">{found.state.name}</dd>
                </div>
              </dl>
              <div className="mt-5 border-t border-divider pt-4">
                <UnitStatusBadge status="not_confirmed" />
                <p className="mt-2 text-ink-muted">
                  No verified photographs of this unit&apos;s EC60E poster have been received yet.
                </p>
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
