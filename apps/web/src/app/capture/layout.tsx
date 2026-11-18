import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { LogoMark } from '@/components/logo';

export const metadata: Metadata = {
  title: 'Photograph a result',
  description: 'Photograph the EC60E result poster at your polling unit.',
};

export const viewport: Viewport = { themeColor: [{ color: '#008751' }] };

/** Focused layout for the capture app: maximum screen for the camera. */
export default function CaptureLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface-muted">
      <div aria-hidden="true" className="flag-band" />
      <header className="border-b border-divider bg-surface">
        <div className="mx-auto flex min-h-12 max-w-lg items-center justify-between px-4">
          <Link href="/" className="inline-flex items-center gap-2 text-ink no-underline">
            <LogoMark size={26} />
            <span className="font-bold tracking-tight">TrustElect</span>
          </Link>
          <Link href="/privacy" className="text-sm font-medium text-ink-muted hover:text-ink">
            Privacy
          </Link>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
