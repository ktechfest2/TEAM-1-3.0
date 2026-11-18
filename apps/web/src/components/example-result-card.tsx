import { UNOFFICIAL_LABEL } from '@trustelect/shared';
import { ComparisonBadge, UnitStatusBadge } from './status-badge';

/** Illustrative only: neutral party names, clearly labelled as an example. */
const ROWS = [
  { party: 'Party A', votes: 112 },
  { party: 'Party B', votes: 98 },
  { party: 'Party C', votes: 140 },
  { party: 'Party D', votes: 21 },
];
const VALID = ROWS.reduce((sum, r) => sum + r.votes, 0);
const REJECTED = 9;

export function ExampleResultCard() {
  return (
    <figure className="card-shadow m-0 rounded-2xl border border-divider bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Example</p>
          <p className="font-semibold">Polling unit 001 · Ward 11</p>
        </div>
        <UnitStatusBadge status="counted" />
      </div>

      <div className="grid gap-4 px-5 py-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-surface-muted px-2 py-3">
            <dt className="text-xs text-ink-muted">Witnesses</dt>
            <dd className="text-xl font-bold tabular">5</dd>
          </div>
          <div className="rounded-xl bg-surface-muted px-2 py-3">
            <dt className="text-xs text-ink-muted">Confidence</dt>
            <dd className="text-xl font-bold">High</dd>
          </div>
          <div className="rounded-xl bg-surface-muted px-2 py-3">
            <dt className="text-xs text-ink-muted">Photos</dt>
            <dd className="text-xl font-bold tabular">7</dd>
          </div>
        </dl>

        <table className="w-full text-sm">
          <caption className="sr-only">Votes by party, in ballot order</caption>
          <thead>
            <tr className="text-left text-ink-muted">
              <th scope="col" className="py-1.5 font-medium">
                Party
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Votes
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {ROWS.map((r) => (
              <tr key={r.party} className="border-t border-divider">
                <th scope="row" className="py-1.5 text-left font-medium">
                  {r.party}
                </th>
                <td className="py-1.5 text-right">{r.votes}</td>
              </tr>
            ))}
            <tr className="border-t border-divider text-ink-muted">
              <th scope="row" className="py-1.5 text-left font-normal">
                Valid · Rejected
              </th>
              <td className="py-1.5 text-right">
                {VALID} · {REJECTED}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-tint px-4 py-3">
          <span className="text-sm font-medium">Ward declaration check</span>
          <ComparisonBadge status="match" />
        </div>
      </div>

      <figcaption className="border-t border-divider px-5 py-3 text-xs text-ink-subtle">
        {UNOFFICIAL_LABEL} · Evidence hash 3f9a…c21e
      </figcaption>
    </figure>
  );
}
