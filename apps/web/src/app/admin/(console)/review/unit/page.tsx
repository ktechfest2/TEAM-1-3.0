import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { UnitReview } from './unit-review';

export const metadata: Metadata = { title: 'Review polling unit' };

export default function UnitReviewPage() {
  return (
    <PageShell title="Review polling unit" description="Compare the versions and the photos behind them, then record which version the evidence supports.">
      <UnitReview />
    </PageShell>
  );
}
