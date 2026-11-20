import Link from 'next/link';
import { LogoMark, Wordmark } from './logo';
import { SiteMenu } from './site-menu';

const LINKS = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/results/elections', label: 'Live results' },
  { href: '/results', label: 'Check a result' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/verify', label: 'Verify' },
];

/** Wide screens: every main section in the bar. Phones and tablets: Send a result and a Menu with everything. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div aria-hidden="true" className="flag-band" />
      <div className="site-header-bar">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-x-4 px-4 py-2 sm:px-6">
          <Link href="/" className="inline-flex shrink-0 items-center gap-2.5 rounded-lg text-ink no-underline">
            <LogoMark size={36} />
            <Wordmark className="text-xl" />
          </Link>
          <div className="flex items-center gap-2">
            <nav aria-label="Primary" className="hidden lg:block">
              <ul className="flex items-center gap-x-1 text-[0.9375rem] font-medium">
                {LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="rounded-lg px-3 py-2 text-ink-muted hover:bg-surface-muted hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <Link
              href="/capture"
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-brand px-4 font-semibold text-brand-ink hover:bg-brand-strong lg:ml-1"
            >
              Send a result
            </Link>
            <SiteMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
