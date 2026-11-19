import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Verifier } from './verifier';

export const metadata: Metadata = {
  title: 'Verify evidence',
  description: 'Check that a TrustElect evidence pack matches the published hash chain.',
};

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

type Anchor = { id: number; seq: number; hash: string; createdAt: string; externalProvider: string | null };
type Head = { head: { seq: number; hash: string; createdAt: string } | null; latestAnchor: Anchor | null };

function when(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

async function PublishedChain() {
  let head: Head | null = null;
  let anchors: Anchor[] = [];
  try {
    const [h, a] = await Promise.all([
      fetch(`${API_URL}/chain/head`, { cache: 'no-store' }),
      fetch(`${API_URL}/chain/anchors?limit=10`, { cache: 'no-store' }),
    ]);
    if (h.ok) head = (await h.json()) as Head;
    if (a.ok) anchors = (await a.json()) as Anchor[];
  } catch {
    /* shown below */
  }
  if (!head) return <p className="text-mismatch">The published chain could not be loaded right now.</p>;

  return (
    <div className="grid gap-5">
      {head.head ? (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-muted">Entries</dt>
          <dd className="font-semibold tabular">{head.head.seq.toLocaleString('en-NG')}</dd>
          <dt className="text-ink-muted">Latest hash</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">{head.head.hash}</dd>
          <dt className="text-ink-muted">Latest entry</dt>
          <dd>{when(head.head.createdAt)}</dd>
        </dl>
      ) : (
        <p className="text-ink-muted">The chain has no entries yet.</p>
      )}

      <div className="grid gap-2">
        <h3 className="font-semibold">Published anchors</h3>
        <p className="text-sm text-ink-muted">
          Every few minutes the latest hash is published here
          {anchors.some((a) => a.externalProvider) ? ' and timestamped on the public OpenTimestamps record' : ''}. Keep a copy:
          if anyone later changed a record, the chain would no longer reach these hashes.
        </p>
        {anchors.length === 0 ? (
          <p className="text-sm text-ink-muted">No anchors published yet.</p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Published anchors" className="overflow-x-auto rounded-xl border border-divider">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Published</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Entry</th>
                  <th scope="col" className="px-3 py-2 font-medium">Hash</th>
                  <th scope="col" className="px-3 py-2 font-medium">Files</th>
                </tr>
              </thead>
              <tbody>
                {anchors.map((a) => (
                  <tr key={a.id} className="border-t border-divider">
                    <td className="px-3 py-2 whitespace-nowrap">{when(a.createdAt)}</td>
                    <td className="px-3 py-2 text-right tabular">{a.seq.toLocaleString('en-NG')}</td>
                    <td className="px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">{a.hash}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a href={`/api/chain/anchors/${a.id}/record.txt`} download className="font-medium text-brand-strong hover:underline">
                        Record
                      </a>
                      {a.externalProvider && (
                        <>
                          {' · '}
                          <a href={`/api/chain/anchors/${a.id}/record.txt.ots`} download className="font-medium text-brand-strong hover:underline">
                            Timestamp proof
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

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
        <Suspense fallback={<p className="text-ink-muted">Loading the chain…</p>}>
          <PublishedChain />
        </Suspense>
      </section>
    </div>
  );
}
