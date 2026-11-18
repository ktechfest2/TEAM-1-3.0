import type { Metadata } from 'next';
import { AuthCard } from '@/components/admin/auth-card';
import { SetupForm } from './setup-form';

export const metadata: Metadata = { title: 'Set up two-factor authentication' };

export default function SetupTwoFactorPage() {
  return (
    <AuthCard
      title="Set up two-factor authentication"
      description="Every TrustElect administrator signs in with a password and a code from their phone."
    >
      <SetupForm />
    </AuthCard>
  );
}
