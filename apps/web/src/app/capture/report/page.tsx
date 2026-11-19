import type { Metadata } from 'next';
import { ReportApp } from '@/components/capture/report-app';

export const metadata: Metadata = { title: 'Report an incident' };

export default function ReportPage() {
  return <ReportApp />;
}
