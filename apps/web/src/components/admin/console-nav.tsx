'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/review', label: 'Review' },
  { href: '/admin/declarations', label: 'Declarations' },
  { href: '/admin/elections', label: 'Elections' },
  { href: '/admin/parties', label: 'Parties' },
  { href: '/admin/register', label: 'Polling units' },
];

/** Plain links, shown until the current page is known (no active highlight). */
export function ConsoleNavFallback() {
  return <NavList pathname={null} />;
}

export function ConsoleNav() {
  return <NavList pathname={usePathname()} />;
}

function NavList({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Console">
      <ul className="flex flex-wrap gap-1">
        {LINKS.map((l) => {
          const current = pathname !== null && (l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={current ? 'page' : undefined}
                className="inline-flex min-h-10 items-center rounded-lg border-b-2 border-transparent px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-semibold aria-[current=page]:text-ink"
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
