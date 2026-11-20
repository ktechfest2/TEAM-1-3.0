'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { WHATSAPP_CHAT_URL } from './whatsapp-chat';

type Item = { href: string; label: string; external?: boolean };

export const MENU: { heading: string; items: Item[] }[] = [
  {
    heading: 'Results',
    items: [
      { href: '/results/elections', label: 'Live results' },
      { href: '/results', label: 'Check a polling unit result' },
    ],
  },
  {
    heading: 'Take part',
    items: [
      { href: '/capture', label: 'Send a result poster' },
      { href: '/capture/report', label: 'Report an incident' },
      { href: WHATSAPP_CHAT_URL, label: 'Ask TrustElect AI on WhatsApp', external: true },
    ],
  },
  {
    heading: 'Trust',
    items: [
      { href: '/incidents', label: 'Incident reports' },
      { href: '/verify', label: 'Verify evidence' },
    ],
  },
  {
    heading: 'About',
    items: [
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/developers', label: 'Developers API' },
      { href: '/privacy', label: 'Privacy notice' },
    ],
  },
];

/** Every section of the site, behind a Menu button on phones and tablets */
export function SiteMenu() {
  const pathname = usePathname();
  // Open on the page it was opened on: navigating elsewhere closes it
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on Escape or a tap outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenOn(null);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenOn(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="lg:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 font-semibold text-ink hover:bg-surface-muted"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
        Menu
      </button>
      <nav
        id={panelId}
        aria-label="All sections"
        hidden={!open}
        className="absolute inset-x-0 top-full z-40 max-h-[calc(100svh-var(--header-height))] overflow-y-auto border-b border-divider bg-surface shadow-lg"
      >
        <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:grid-cols-2 sm:px-6">
          {MENU.map((group) => (
            <div key={group.heading} className="grid content-start gap-1">
              <p className="px-3 text-xs font-semibold tracking-wide text-ink-subtle uppercase">{group.heading}</p>
              <ul className="grid">
                {group.items.map((item) => (
                  <li key={item.href}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpen(false)}
                        className="flex min-h-11 items-center rounded-lg px-3 font-medium text-ink hover:bg-surface-muted"
                      >
                        {item.label}
                        <span className="sr-only"> (opens WhatsApp)</span>
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={pathname === item.href ? 'page' : undefined}
                        className="flex min-h-11 items-center rounded-lg px-3 font-medium text-ink hover:bg-surface-muted aria-[current=page]:bg-surface-tint aria-[current=page]:text-brand-strong"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
