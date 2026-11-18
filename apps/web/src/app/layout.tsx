import type { Metadata, Viewport } from 'next';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TrustElect: citizen-verified election results',
    template: '%s · TrustElect',
  },
  description:
    'Voters photograph polling unit result posters. TrustElect verifies them, counts them from the polling unit up, and shows where declared results match.',
  other: {
    // Follow the operating system's text size setting where supported
    'text-scale': 'scale',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#152033' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NG" className="h-full">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="absolute left-4 top-2 z-10 -translate-y-20 rounded bg-brand px-3 py-2 font-semibold text-brand-ink focus:translate-y-0"
        >
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
