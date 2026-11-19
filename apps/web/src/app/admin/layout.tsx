import type { Metadata } from 'next';
import { LogoMark, Wordmark } from '@/components/logo';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · TrustElect Admin' },
  robots: { index: false, follow: false, nocache: true },
};

/** Private admin area: own layout, no links from or to the public site. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface-muted">
      <div aria-hidden="true" className="flag-band" />
      <header className="border-b border-divider bg-surface">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-2.5 px-4 sm:px-6">
          <LogoMark size={30} />
          <Wordmark className="text-lg" />
          <span className="rounded-md bg-surface-tint px-2 py-0.5 text-xs font-semibold text-brand-strong">
            Admin
          </span>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
