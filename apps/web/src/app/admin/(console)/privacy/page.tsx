import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Privacy } from './privacy-view';

export const metadata: Metadata = { title: 'Privacy and access' };

export default function PrivacyAdminPage() {
  return (
    <PageShell
      title="Privacy and access"
      description="Erasure requests, retention of personal data and the review of who can use this console (Nigeria Data Protection Act 2023). System administrators only; every action is in the audit log."
    >
      <Privacy />
    </PageShell>
  );
}
