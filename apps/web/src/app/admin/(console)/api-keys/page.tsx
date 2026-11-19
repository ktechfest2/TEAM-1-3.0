import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { ApiKeys } from './api-keys-view';

export const metadata: Metadata = { title: 'API keys' };

export default function ApiKeysPage() {
  return (
    <PageShell
      title="API keys"
      description="Organisations that registered on the developers page. A key works only after a system administrator approves it, and stops working at once when revoked. Every decision is recorded in the audit log."
    >
      <ApiKeys />
    </PageShell>
  );
}
