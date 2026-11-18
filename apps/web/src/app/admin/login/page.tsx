import type { Metadata } from 'next';
import { AuthCard } from '@/components/admin/auth-card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function AdminLoginPage() {
  return (
    <AuthCard title="Sign in" description="TrustElect admin console.">
      <LoginForm />
    </AuthCard>
  );
}
