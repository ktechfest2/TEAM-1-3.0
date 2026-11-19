import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UnitSearch } from '@/components/unit-search';
import { UnitLookup } from './unit-lookup';

export const metadata: Metadata = { title: 'Results' };

export default function ResultsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Find a result</h1>
      <p className="mt-2 max-w-[60ch] text-ink-muted">
        Look up the citizen-collated result for any polling unit, with its witnesses and confidence.
      </p>
      <div className="mt-6">
        <Suspense fallback={<div className="max-w-xl"><UnitSearch /></div>}>
          <UnitLookup />
        </Suspense>
      </div>
    </div>
  );
}
