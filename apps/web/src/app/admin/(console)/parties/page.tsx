import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Parties } from './parties-view';

export const metadata: Metadata = { title: 'Parties' };

export default function PartiesPage() {
  return (
    <PageShell
      title="Parties"
      description="Parties available for elections. Each election lists the parties on its ballot in ballot order."
    >
      <Parties />
    </PageShell>
  );
}
