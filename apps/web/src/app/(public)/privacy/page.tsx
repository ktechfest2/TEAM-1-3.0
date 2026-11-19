import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy notice' };

const CONTACT = 'francisvictor.st@gmail.com';

const SECTIONS: { id?: string; title: string; body: React.ReactNode }[] = [
  {
    title: 'Who we are',
    body: (
      <p>
        TrustElect is a citizen election evidence platform run by Team 1 (KTech Fest 3.0). It is not INEC and is not
        affiliated with any party or candidate. Contact:{' '}
        <a href={`mailto:${CONTACT}`} className="font-medium text-brand-strong hover:underline">
          {CONTACT}
        </a>
        .
      </p>
    ),
  },
  {
    title: 'What we collect, and why',
    body: (
      <ul className="grid list-disc gap-2 pl-5">
        <li>
          <strong>Your phone number</strong>: to count each person as one witness and to spot one person sending many
          photos. We store it encrypted, plus a one-way fingerprint used for counting. It is never shown
          publicly or shared.
        </li>
        <li>
          <strong>Photos of result posters</strong>: the evidence itself, with the time it was taken and a fingerprint
          (hash) that shows if it is ever changed.
        </li>
        <li>
          <strong>Your location</strong>: only if you choose to share it, to show the photo was taken at the polling
          unit.
        </li>
        <li>
          <strong>Technical records</strong>: the time your submission arrived and security logs needed to stop abuse.
        </li>
      </ul>
    ),
  },
  {
    id: 'whatsapp',
    title: 'On WhatsApp',
    body: (
      <ul className="grid list-disc gap-2 pl-5">
        <li>
          We ask for your consent the first time you message TrustElect. Your WhatsApp number is stored encrypted and is
          used in the same way as above.
        </li>
        <li>
          We do not keep the text of your messages. We keep only message identifiers and delivery status, the polling unit
          you asked about (so you need not repeat it), your preferred language, and any result figures you send.
        </li>
        <li>
          To answer questions, the text of your message is sent to an AI service that does not keep it or use it for
          training. Result figures never come from the AI.
        </li>
        <li>Messages are delivered through WhatsApp (Meta), under WhatsApp&apos;s own terms and privacy policy.</li>
      </ul>
    ),
  },
  {
    id: 'processors',
    title: 'Who helps us, and where',
    body: (
      <>
        <p>These services process data for TrustElect, only for the purposes above:</p>
        <ul className="mt-2 grid list-disc gap-1 pl-5">
          <li>WhatsApp (Meta), for WhatsApp messages.</li>
          <li>Africa&apos;s Talking and BulkSMSLive, for SMS, USSD and sign-in codes.</li>
          <li>AI services through OpenRouter, to check photos and answer questions; they are asked not to keep or train on the data.</li>
          <li>Our hosting providers, for the website and the servers that store the evidence.</li>
        </ul>
        <p className="mt-2">
          Some of these process data outside Nigeria. By giving consent you agree to this transfer, which the Nigeria Data Protection Act
          2023 allows with your consent.
        </p>
      </>
    ),
  },
  {
    title: 'What we publish',
    body: (
      <p>
        We publish result figures read from posters, the number of independent witnesses, and evidence fingerprints. We
        never publish who submitted a photo. Photos may be released in evidence packs for disputes, but never with your
        phone number.
      </p>
    ),
  },
  {
    title: 'Legal basis',
    body: (
      <p>
        We process your data with your consent, given before you enter your phone number, and in the public interest of
        transparent elections, in line with the Nigeria Data Protection Act 2023.
      </p>
    ),
  },
  {
    title: 'How long we keep it',
    body: (
      <p>
        Photos that are not genuine EC60E posters are not stored. Accepted photos and records are kept as election
        evidence until any disputes about that election are finally settled, then deleted or anonymised.
      </p>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights and deleting your data',
    body: (
      <p>
        You can ask to see the data we hold about your number, correct it, or have it deleted, and you can withdraw
        consent at any time. To have your data deleted, email{' '}
        <a href={`mailto:${CONTACT}`} className="font-medium text-brand-strong hover:underline">
          {CONTACT}
        </a>{' '}
        from any address, giving the phone number you used; we confirm and delete it within 30 days. Evidence already used in a published result may be kept in anonymised form
        so that the public record stays complete. You can also complain to the Nigeria Data Protection Commission.
      </p>
    ),
  },
  {
    title: 'Security',
    body: (
      <p>
        Data is encrypted in transit and phone numbers are encrypted at rest. Only a small, named review team can see
        phone numbers, and every administrative action is recorded. We use no advertising and no third-party trackers.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Privacy notice</h1>
      <p className="mt-2 text-ink-muted">How TrustElect handles your information, in plain language.</p>
      <div className="mt-8 grid gap-8">
        {SECTIONS.map((s) => (
          <section key={s.title} id={s.id} className="grid scroll-mt-24 gap-2">
            <h2 className="text-xl font-semibold">{s.title}</h2>
            <div className="max-w-[70ch] text-ink-muted [&_strong]:text-ink">{s.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
