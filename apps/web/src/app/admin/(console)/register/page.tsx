import type { Metadata } from 'next';
import { PageShell } from '@/components/admin/page-shell';
import { Register } from './register-view';

export const metadata: Metadata = { title: 'Polling units' };

export default function RegisterPage() {
  return (
    <PageShell
      title="Polling units"
      description="INEC's polling unit register: every unit's code and its ward, LGA and state. Used to check unit codes on posters and to add results up."
    >
      <Register />
    </PageShell>
  );
}
