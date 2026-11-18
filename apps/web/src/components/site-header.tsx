import Link from 'next/link';
import { LogoMark } from './logo';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div aria-hidden="true" className="flag-band" />
      <div className="site-header-bar">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg text-ink no-underline">
            <LogoMark />
            <span className="text-xl font-bold tracking-tight">TrustElect</span>
          </Link>
          <nav aria-label="Primary">
            <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[0.9375rem] font-medium">
              <li>
                <Link
                  href="/#how-it-works"
                  className="rounded-lg px-3 py-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  How it works
                </Link>
              </li>
              <li>
                <Link
                  href="/results"
                  className="ml-1 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-brand-ink hover:bg-brand-strong"
                >
                  Check a result
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
}
