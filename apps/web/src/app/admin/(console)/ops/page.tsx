import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Ops } from './ops-view';

export const metadata: Metadata = { title: 'Operations' };

export default function OpsPage() {
  return (
    <PageShell title="Operations" description="Election-day view: alerts, coverage, review workload and everything waiting for a person. Updates live.">
      <Ops />
    </PageShell>
  );
}
