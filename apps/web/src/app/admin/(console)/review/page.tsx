import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Queue } from './queue';

export const metadata: Metadata = { title: 'Review queue' };

export default function ReviewPage() {
  return (
    <PageShell
      title="Review queue"
      description="Polling units where photos disagree (disputed or provisional) or where a pattern needs a human look. Disputed units come first."
    >
      <Queue />
    </PageShell>
  );
}
