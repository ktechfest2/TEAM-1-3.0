import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Incidents } from './incidents-view';

export const metadata: Metadata = { title: 'Incident reports' };

export default function IncidentsAdminPage() {
  return (
    <PageShell
      title="Incident reports"
      description="Serious reports (violence, ballot snatching, vote buying, other) and reports that may identify private people are held here whatever the AI suggests. Decide the label and whether to publish. The sender is never shown."
    >
      <Incidents />
    </PageShell>
  );
}
