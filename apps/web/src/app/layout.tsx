import type { Metadata, Viewport } from 'next';
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
  colorScheme: 'light',
  themeColor: [{ color: '#008751' }],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NG" className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
