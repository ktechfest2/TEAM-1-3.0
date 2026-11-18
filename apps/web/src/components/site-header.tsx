import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-divider bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="inline-flex items-center gap-2 rounded text-ink no-underline">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            aria-hidden="true"
            focusable="false"
            className="text-brand"
          >
            <rect x="1" y="1" width="26" height="26" rx="7" fill="currentColor" />
            <path
              d="m8.5 14.5 3.6 3.6 7.4-8"
              fill="none"
              stroke="var(--brand-ink)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-lg font-bold tracking-tight">TrustElect</span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
            <li>
              <Link href="/results" className="text-ink-muted hover:text-ink">
                Results
              </Link>
            </li>
            <li>
              <Link href="/#how-it-works" className="text-ink-muted hover:text-ink">
                How it works
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
