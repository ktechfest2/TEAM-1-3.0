import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Knowledge } from './knowledge-view';

export const metadata: Metadata = { title: 'Assistant knowledge' };

export default function KnowledgePage() {
  return (
    <PageShell
      title="Assistant knowledge"
      description="The only facts the WhatsApp assistant may use. Each comes from an official source; one administrator enters it, a second approves it. Edited facts stop being used until they are approved again."
    >
      <Knowledge />
    </PageShell>
  );
}
