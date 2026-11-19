import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Declarations } from './declarations-view';

export const metadata: Metadata = { title: 'Declared results' };

export default function DeclarationsPage() {
  return (
    <PageShell
      title="Declared results"
      description="Official ward, LGA, state and national declarations, recorded from official sources. One administrator records, a second approves, and only approved declarations are compared with citizen results."
    >
      <Declarations />
    </PageShell>
  );
}
