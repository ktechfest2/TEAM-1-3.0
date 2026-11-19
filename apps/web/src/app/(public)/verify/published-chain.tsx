'use client';

import { useApi } from '@/lib/api';
import { apiUrl } from '@/lib/api-url';


type Anchor = { id: number; seq: number; hash: string; createdAt: string; externalProvider: string | null };
type Head = { head: { seq: number; hash: string; createdAt: string } | null; latestAnchor: Anchor | null };

function when(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

export function PublishedChain() {
  const h = useApi<Head>('/chain/head');
  const a = useApi<Anchor[]>('/chain/anchors?limit=10');
  if (h.status === 'loading') return <p role="status" className="text-ink-muted">Loading the chain…</p>;
  if (h.status === 'error') return <p className="text-mismatch">The published chain could not be loaded right now.</p>;
  const head = h.data;
  const anchors = a.status === 'ready' ? a.data : [];

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
                      <a href={apiUrl(`/chain/anchors/${a.id}/record.txt`)} download className="font-medium text-brand-strong hover:underline">
                        Record
                      </a>
                      {a.externalProvider && (
                        <>
                          {' · '}
                          <a href={apiUrl(`/chain/anchors/${a.id}/record.txt.ots`)} download className="font-medium text-brand-strong hover:underline">
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
