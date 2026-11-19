/** TrustElect's WhatsApp number (international format, digits only). Override with NEXT_PUBLIC_WHATSAPP_NUMBER. */
const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '2349158961770').replace(/\D/g, '');

/** Opens a WhatsApp chat with the TrustElect assistant, starting with "Hi" so it greets the voter. */
export const WHATSAPP_CHAT_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi')}`;

export function WhatsAppIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* Speech bubble with a handset: the familiar chat-on-WhatsApp shape */}
      <path
        d="M12 2.75a9.25 9.25 0 0 0-7.98 13.93L2.75 21.25l4.7-1.23A9.25 9.25 0 1 0 12 2.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.6 7.4c.25-.5.5-.52.78-.52h.55c.18 0 .4.02.58.45l.72 1.75c.08.2.06.4-.04.57l-.45.66c-.1.16-.1.35 0 .5.5.88 1.2 1.6 2.1 2.1.16.1.35.1.5 0l.66-.45c.17-.1.37-.12.57-.04l1.75.72c.43.18.45.4.45.58v.55c0 .28-.02.53-.52.78-.6.3-1.56.52-3.05-.2-1.55-.76-2.86-2.07-3.62-3.62-.72-1.49-.5-2.45-.2-3.05Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Floating button on every public page: chat with the TrustElect AI assistant on WhatsApp. */
export function WhatsAppChatButton() {
  return (
    <a
      href={WHATSAPP_CHAT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 inline-flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-full bg-brand-strong px-4 font-semibold text-brand-ink shadow-lg shadow-black/20 hover:bg-brand sm:px-5 print:hidden"
    >
      <WhatsAppIcon size={26} />
      <span className="sr-only sm:not-sr-only">Chat with TrustElect AI</span>
      <span className="sr-only"> on WhatsApp (opens WhatsApp)</span>
    </a>
  );
}
