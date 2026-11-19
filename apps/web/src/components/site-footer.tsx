import Link from 'next/link';
import { UNOFFICIAL_LABEL } from '@trustelect/shared';
import { LogoMark, Wordmark } from './logo';
import { WHATSAPP_CHAT_URL } from './whatsapp-chat';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-divider bg-surface-muted">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-3">
          <div className="inline-flex items-center gap-2.5">
            <LogoMark size={32} />
            <Wordmark className="text-lg" />
          </div>
          <p className="max-w-[48ch] text-ink-muted">
            Citizen-verified polling unit results, counted from the polling unit up and compared
            with what is officially declared.
          </p>
        </div>
        <div className="grid content-start gap-3 text-sm text-ink-muted">
          <p>
            <strong className="text-ink">{UNOFFICIAL_LABEL}.</strong> TrustElect is not INEC and
            does not declare winners. Figures come from EC60E posters already pasted at polling
            units. Official results are declared by INEC.
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-1">
            <a
              href={WHATSAPP_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-strong hover:underline"
            >
              Ask TrustElect AI on WhatsApp
            </a>
            <Link href="/incidents" className="font-medium text-brand-strong hover:underline">
              Incident reports
            </Link>
            <Link href="/verify" className="font-medium text-brand-strong hover:underline">
              Verify evidence
            </Link>
            <Link href="/privacy" className="font-medium text-brand-strong hover:underline">
              Privacy notice
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
