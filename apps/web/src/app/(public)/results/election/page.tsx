import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Dashboard } from './dashboard';

export const metadata: Metadata = { title: 'Live results' };

export default function LiveResultsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Suspense fallback={<p role="status" className="text-ink-muted">Loading results…</p>}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
