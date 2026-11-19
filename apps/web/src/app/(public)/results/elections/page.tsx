import type { Metadata } from 'next';
import { Elections } from './elections-list';

export const metadata: Metadata = { title: 'Live results' };

export default function ElectionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Live results</h1>
      <p className="mt-2 max-w-[60ch] text-ink-muted">
        Citizen-collated totals, added up from verified polling unit photos. Each total shows how many polling units it
        covers.
      </p>
      <div className="mt-6">
        <Elections />
      </div>
    </div>
  );
}
