import type { Metadata } from 'next';
import { Overview } from './overview';

export const metadata: Metadata = { title: 'Console' };

export default function AdminHomePage() {
  return <Overview />;
}
