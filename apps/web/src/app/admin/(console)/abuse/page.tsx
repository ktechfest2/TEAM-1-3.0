import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Abuse } from './abuse-view';

export const metadata: Metadata = { title: 'Abuse' };

export default function AbusePage() {
  return (
    <PageShell
      title="Abuse"
      description="Patterns that suggest one person posing as several witnesses, or a number sending fakes. Numbers are shown masked. Blocking refuses the number on every channel and stops its evidence counting; it is recorded in the audit log and can be undone."
    >
      <Abuse />
    </PageShell>
  );
}
