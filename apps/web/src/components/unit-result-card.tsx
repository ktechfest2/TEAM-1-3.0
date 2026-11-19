import Link from 'next/link';
import { UNOFFICIAL_LABEL } from '@trustelect/shared';
import { UnitStatusBadge } from './status-badge';

export type PublicUnitResult = {
  election: { id: string; title: string; electionDate: string; status: string };
  status: 'not_confirmed' | 'counted' | 'provisional' | 'disputed' | 'resolved';
  confidence: 'low' | 'medium' | 'high' | null;
  witnessCount: number;
  stampedWitnesses: number;
  strongWitnesses: number;
  versionCount: number;
  updatedAt: string | null;
  parties: { acronym: string; name: string }[];
  figures: { partyVotes: Record<string, number>; totalValid: number; rejected: number | null; totalCast: number | null } | null;
};

const CONFIDENCE: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

export function UnitResultCard({ result, unitCode }: { result: PublicUnitResult; unitCode?: string }) {
  const { figures } = result;
  return (
    <article className="rounded-2xl border border-divider bg-surface" aria-labelledby={`r-${result.election.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-5 py-4">
        <div>
          <h3 id={`r-${result.election.id}`} className="font-semibold">{result.election.title}</h3>
          {result.updatedAt && <p className="text-sm text-ink-muted">Updated {when(result.updatedAt)}</p>}
        </div>
        <UnitStatusBadge status={result.status} />
      </header>

      <div className="grid gap-4 px-5 py-4">
        {result.status === 'not_confirmed' && (
          <p className="text-ink-muted">No verified photographs of this unit&apos;s EC60E poster have been received yet.</p>
        )}
        {result.status === 'disputed' && (
          <p className="text-ink-muted">
            Photos from different witnesses show {result.versionCount} different sets of figures with equal support. The
            review team is checking them; no figures are counted until then.
          </p>
        )}

        {figures && (
          <>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-surface-muted px-2 py-3">
                <dt className="text-xs text-ink-muted">Witnesses</dt>
                <dd className="text-xl font-bold tabular">{result.witnessCount}</dd>
              </div>
              <div className="rounded-xl bg-surface-muted px-2 py-3">
                <dt className="text-xs text-ink-muted">Confidence</dt>
                <dd className="text-lg font-bold capitalize">{result.confidence ?? '–'}</dd>
              </div>
              <div className="rounded-xl bg-surface-muted px-2 py-3">
                <dt className="text-xs text-ink-muted">With stamp</dt>
                <dd className="text-xl font-bold tabular">{result.stampedWitnesses}</dd>
              </div>
            </dl>

            <table className="w-full text-sm">
              <caption className="sr-only">Votes by party, in ballot order</caption>
              <thead>
                <tr className="text-left text-ink-muted">
                  <th scope="col" className="py-1.5 font-medium">Party</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Votes</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {result.parties.map((p) => (
                  <tr key={p.acronym} className="border-t border-divider">
                    <th scope="row" className="py-1.5 text-left font-medium">
                      {p.acronym} <span className="font-normal text-ink-muted">{p.name}</span>
                    </th>
                    <td className="py-1.5 text-right">{(figures.partyVotes[p.acronym] ?? 0).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
                <tr className="border-t border-divider text-ink-muted">
                  <th scope="row" className="py-1.5 text-left font-normal">Total valid votes</th>
                  <td className="py-1.5 text-right">{figures.totalValid.toLocaleString('en-NG')}</td>
                </tr>
                {figures.rejected !== null && (
                  <tr className="text-ink-muted">
                    <th scope="row" className="py-1.5 text-left font-normal">Rejected</th>
                    <td className="py-1.5 text-right">{figures.rejected.toLocaleString('en-NG')}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <p className="text-sm text-ink-muted">
              {result.confidence ? `${CONFIDENCE[result.confidence]}: ` : ''}
              {result.witnessCount} independent {result.witnessCount === 1 ? 'witness' : 'witnesses'} photographed these
              figures{result.stampedWitnesses === 0 ? ', with no stamp visible on the poster' : ''}.
              {result.status === 'provisional' && ' Some witnesses report different figures; the review team is checking.'}
              {result.status === 'resolved' && ' Different figures were reported; the review team decided which the evidence supports.'}
            </p>
          </>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-divider px-5 py-3 text-xs text-ink-subtle">
        <span>{UNOFFICIAL_LABEL}</span>
        {unitCode && result.status !== 'not_confirmed' && (
          <span className="flex flex-wrap gap-x-4 text-sm">
            <a href={`/api/evidence/elections/${result.election.id}/units/${unitCode}`} download className="font-medium text-brand-strong hover:underline">
              Download evidence pack
            </a>
            <Link href="/verify" className="font-medium text-brand-strong hover:underline">
              Verify it
            </Link>
          </span>
        )}
      </footer>
    </article>
  );
}
