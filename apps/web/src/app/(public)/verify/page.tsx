import type { Metadata } from 'next';
import { PublishedChain } from './published-chain';
import { Verifier } from './verifier';

export const metadata: Metadata = {
  title: 'Verify evidence',
  description: 'Check that a TrustElect evidence pack matches the published hash chain.',
};

export default function VerifyPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-10 sm:px-6">
      <div className="grid gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Verify evidence</h1>
        <p className="text-lg text-ink-muted">
          Every accepted photo, polling unit result, declared result and administrator action is written to an
          append-only hash chain. Each entry includes the hash of the one before it, so changing any record later,
          by anyone, including TrustElect&apos;s own operators, breaks the chain.
        </p>
      </div>

      <section aria-labelledby="check-heading" className="grid gap-4 rounded-2xl border border-divider bg-surface p-5">
        <h2 id="check-heading" className="text-xl font-semibold">Check an evidence pack</h2>
        <p className="text-sm text-ink-muted">
          Download a pack from a polling unit result or a ward page, then select it here. The check confirms that every
          record matches its chain entry, that the entries are part of the published chain and its anchors, that the
          records have not changed since, and that every photo matches the hash recorded when it arrived.
        </p>
        <Verifier />
      </section>

      <section aria-labelledby="chain-heading" className="grid gap-4 rounded-2xl border border-divider bg-surface p-5">
        <h2 id="chain-heading" className="text-xl font-semibold">The published chain</h2>
        <PublishedChain />
      </section>
    </div>
  );
}
