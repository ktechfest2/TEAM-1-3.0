import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UnitStatusBadge } from '@/components/status-badge';
import { UnitSearch } from '@/components/unit-search';

export const metadata: Metadata = { title: 'Results' };

const UNIT_CODE = /^\d{2}-\d{2}-\d{2}-\d{3}$/;

async function UnitLookup({ searchParams }: { searchParams: PageProps<'/results'>['searchParams'] }) {
  const { unit } = await searchParams;
  const code = typeof unit === 'string' ? unit.trim() : undefined;

  return (
    <>
      <div className="max-w-xl">
        <UnitSearch defaultValue={code} />
      </div>
      {code && (
        <section aria-live="polite" className="mt-8 rounded-xl border border-divider bg-surface p-5">
          {UNIT_CODE.test(code) ? (
            <>
              <h2 className="text-lg font-semibold">
                Polling unit <span className="tabular">{code}</span>
              </h2>
              <div className="mt-3">
                <UnitStatusBadge status="not_confirmed" />
              </div>
              <p className="mt-3 text-ink-muted">
                No verified photographs of this unit&apos;s EC60E poster have been received yet.
              </p>
            </>
          ) : (
            <p className="text-mismatch">
              <strong>{code}</strong> is not a valid polling unit code. Use the format
              24-05-11-003.
            </p>
          )}
        </section>
      )}
    </>
  );
}

export default function ResultsPage(props: PageProps<'/results'>) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
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
