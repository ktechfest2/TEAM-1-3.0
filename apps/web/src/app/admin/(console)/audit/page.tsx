import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { AuditLog } from './audit-view';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditPage() {
  return (
    <PageShell title="Audit log" description="Every administrative action, newest first. Each entry is also written to the hash chain. System administrators only.">
      <AuditLog />
    </PageShell>
  );
}
