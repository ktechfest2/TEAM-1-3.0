import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Elections } from './elections-view';

export const metadata: Metadata = { title: 'Elections' };

export default function ElectionsPage() {
  return (
    <PageShell
      title="Elections"
      description="Set up each election with its date, area and the parties on its ballot. Drafts are hidden from the public."
    >
      <Elections />
    </PageShell>
  );
}
