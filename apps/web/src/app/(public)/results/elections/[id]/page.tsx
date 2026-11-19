import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { UNOFFICIAL_LABEL } from '@trustelect/shared';
import { LiveRefresh } from '@/components/results/live-refresh';
import { CHILD_HEADING, CHILD_LABEL, n, pct, type Comparison, type TallyResponse } from '@/components/results/tally-types';
import { ComparisonBadge, UnitStatusBadge } from '@/components/status-badge';

export const metadata: Metadata = { title: 'Live results' };

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const LEVELS = new Set(['national', 'state', 'lga', 'ward']);
const NEXT_LEVEL = { state: 'state', lga: 'lga', ward: 'ward' } as const;

async function load(id: string, level?: string, code?: string): Promise<TallyResponse | 'not_found' | 'error'> {
  const q = new URLSearchParams();
  if (level && LEVELS.has(level)) q.set('level', level);
  if (code && /^[\d-]{2,12}$/.test(code)) q.set('code', code);
  try {
    const res = await fetch(`${API_URL}/results/elections/${encodeURIComponent(id)}?${q}`, { cache: 'no-store' });
    if (res.status === 404 || res.status === 400) return 'not_found';
    if (!res.ok) return 'error';
    return (await res.json()) as TallyResponse;
  } catch {
    return 'error';
  }
}

function MixList({ mix }: { mix: TallyResponse['totals']['mix'] }) {
  const items: [string, number, string][] = [
    ['High confidence', mix.high, 'bg-match-bg text-match'],
    ['Medium confidence', mix.medium, 'bg-match-bg text-match'],
    ['Low confidence', mix.low, 'bg-dispute-bg text-dispute'],
    ['Provisional', mix.provisional, 'bg-dispute-bg text-dispute'],
    ['Disputed (not counted)', mix.disputed, 'bg-mismatch-bg text-mismatch'],
    ['No result yet', mix.notConfirmed, 'bg-pending-bg text-pending'],
  ];
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Polling units by confidence">
      {items.map(([label, value, cls]) => (
        <li key={label} className={`rounded-full px-3 py-1 text-sm font-medium ${cls}`}>
          <span className="font-bold tabular">{n(value)}</span> {label.toLowerCase()}
        </li>
      ))}
    </ul>
  );
}

function DeclaredComparison({ comparison, areaName }: { comparison?: Comparison; areaName: string }) {
  if (!comparison) return null;
  const declared = comparison.parties.length > 0;
  return (
    <section aria-labelledby="declared-heading" className="rounded-2xl border border-divider bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-4">
        <h2 id="declared-heading" className="font-semibold">Declared result compared with citizen results</h2>
        <ComparisonBadge status={comparison.status} />
      </div>
      {!declared ? (
        <p className="px-5 py-4 text-ink-muted">
          No approved official declaration for {areaName} yet. The comparison appears here once one is recorded and approved.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Declared votes and citizen-confirmed votes by party, in ballot order</caption>
              <thead>
                <tr className="text-left text-ink-muted">
                  <th scope="col" className="px-5 py-2 font-medium">Party</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Declared</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Citizen confirmed</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {comparison.parties.map((p) => (
                  <tr key={p.party} className={`border-t border-divider ${p.exceedsDeclared ? 'bg-mismatch-bg' : ''}`}>
                    <th scope="row" className="px-5 py-2 text-left font-medium">{p.party}</th>
                    <td className="px-5 py-2 text-right">{n(p.declared)}</td>
                    <td className="px-5 py-2 text-right">{n(p.citizen)}</td>
                    <td className={`px-5 py-2 text-right ${p.exceedsDeclared ? 'font-semibold text-mismatch' : ''}`}>
                      {p.citizen - p.declared > 0 ? '+' : ''}
                      {n(p.citizen - p.declared)}
                      {p.exceedsDeclared && <span className="sr-only"> (citizen votes exceed the declared figure)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {comparison.reasons.length > 0 && (
            <ul className="grid gap-1 border-t border-divider px-5 py-3 text-sm">
              {comparison.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {comparison.unitDifferences.length > 0 && (
            <p className="border-t border-divider px-5 py-3 text-sm">
              Polling units listed differently from their counted result:{' '}
              <span className="font-mono">{comparison.unitDifferences.join(', ')}</span>
            </p>
          )}
        </>
      )}
      {comparison.disputeExists && (
        <p className="border-t border-divider bg-dispute-bg px-5 py-3 text-sm text-dispute">
          Some polling units in this area are disputed or provisional. Their outcome could change this comparison.
        </p>
      )}
      {declared && !comparison.fullCoverage && (
        <p className="border-t border-divider px-5 py-3 text-sm text-ink-muted">
          Citizen results do not yet cover every polling unit, so citizen totals are expected to be lower than declared
          totals. A difference is only flagged when confirmed citizen votes are higher than declared.
        </p>
      )}
    </section>
  );
}

async function Dashboard({ params, searchParams }: PageProps<'/results/elections/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await load(id, typeof sp.level === 'string' ? sp.level : undefined, typeof sp.code === 'string' ? sp.code : undefined);

  if (data === 'not_found') {
    return <p className="text-ink-muted">This election or area was not found.</p>;
  }
  if (data === 'error') {
    return <p className="text-mismatch">Results could not be loaded right now. Please try again shortly.</p>;
  }

  const { totals, parties, area, childLevel } = data;
  const hasComparisons = data.children.some((c) => c.comparison);
  const childHref = (code: string) =>
    childLevel === 'polling_unit'
      ? `/results?unit=${code}`
      : `/results/elections/${data.election.id}?level=${NEXT_LEVEL[childLevel]}&code=${code}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid gap-3">
        <nav aria-label="Area">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            {area.path.map((p, i) => (
              <li key={`${p.level}-${p.code}`} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {i === area.path.length - 1 ? (
                  <span aria-current="page" className="font-medium text-ink">{p.name}</span>
                ) : (
                  <Link href={`/results/elections/${data.election.id}?level=${p.level}${p.code ? `&code=${p.code}` : ''}`} className="hover:text-ink hover:underline">
                    {p.name}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-strong">{data.election.title}</p>
            <h1 className="text-3xl font-bold tracking-tight">{area.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {area.level === 'ward' && area.code && (
              <a
                href={`/api/evidence/elections/${data.election.id}/wards/${area.code}`}
                download
                className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-muted"
              >
                Download ward evidence pack
              </a>
            )}
            <LiveRefresh electionId={data.election.id} generatedAt={data.generatedAt} />
          </div>
        </div>
      </div>

      <section aria-labelledby="coverage-heading" className="grid gap-3 rounded-2xl border border-divider bg-surface p-5">
        <h2 id="coverage-heading" className="font-semibold">Coverage</h2>
        <p className="text-lg">
          Computed from <strong className="tabular">{n(totals.countedUnits)}</strong> of{' '}
          <strong className="tabular">{n(totals.totalUnits)}</strong> polling units ({pct(totals.countedUnits, totals.totalUnits)})
        </p>
        <progress
          value={totals.countedUnits}
          max={Math.max(totals.totalUnits, 1)}
          aria-labelledby="coverage-heading"
          className="coverage-bar"
        />
        <MixList mix={totals.mix} />
      </section>

      <section aria-labelledby="totals-heading" className="rounded-2xl border border-divider bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider px-5 py-4">
          <h2 id="totals-heading" className="font-semibold">Votes in counted polling units</h2>
          <p className="text-sm text-ink-muted">Parties in ballot order</p>
        </div>
        <table className="w-full text-sm">
          <caption className="sr-only">Votes by party in counted polling units, in ballot order</caption>
          <thead>
            <tr className="text-left text-ink-muted">
              <th scope="col" className="px-5 py-2 font-medium">Party</th>
              <th scope="col" className="px-5 py-2 text-right font-medium">Votes</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {parties.map((p) => (
              <tr key={p.acronym} className="border-t border-divider">
                <th scope="row" className="px-5 py-2 text-left font-medium">
                  {p.acronym} <span className="font-normal text-ink-muted">{p.name}</span>
                </th>
                <td className="px-5 py-2 text-right">{n(totals.partyVotes[p.acronym] ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-t border-divider">
              <th scope="row" className="px-5 py-2 text-left font-semibold">Total valid votes</th>
              <td className="px-5 py-2 text-right font-semibold">{n(totals.totalValid)}</td>
            </tr>
            {totals.rejectedReportedUnits > 0 && (
              <tr className="text-ink-muted">
                <th scope="row" className="px-5 py-2 text-left font-normal">
                  Rejected votes ({n(totals.rejectedReportedUnits)} units show them)
                </th>
                <td className="px-5 py-2 text-right">{n(totals.rejected)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-divider px-5 py-3 text-sm text-ink-muted">
          {UNOFFICIAL_LABEL}. These totals cover only the polling units listed as counted above. They are not a
          projection and do not show who is winning. Official results are declared by INEC.
        </p>
      </section>

      <DeclaredComparison comparison={totals.comparison} areaName={area.name} />

      <section aria-labelledby="areas-heading" className="grid gap-3">
        <h2 id="areas-heading" className="text-xl font-semibold">{CHILD_HEADING[childLevel]}</h2>
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="areas-heading"
          className="max-h-[70vh] overflow-auto rounded-2xl border border-divider bg-surface"
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-surface-muted">
              <tr className="text-left text-ink-muted">
                <th scope="col" className="sticky left-0 z-20 bg-surface-muted px-4 py-2 font-medium">{CHILD_LABEL[childLevel]}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium whitespace-nowrap">
                  {childLevel === 'polling_unit' ? 'Status' : 'Counted units'}
                </th>
                {parties.map((p) => (
                  <th key={p.acronym} scope="col" className="px-4 py-2 text-right font-medium">{p.acronym}</th>
                ))}
                <th scope="col" className="px-4 py-2 text-right font-medium whitespace-nowrap">Total valid</th>
                {hasComparisons && <th scope="col" className="px-4 py-2 text-left font-medium whitespace-nowrap">Compared with declaration</th>}
              </tr>
            </thead>
            <tbody className="tabular">
              {data.children.map((c) => (
                <tr key={c.code}>
                  <th scope="row" className="sticky left-0 border-t border-divider bg-surface px-4 py-2 text-left font-medium">
                    <Link href={childHref(c.code!)} className="text-brand-strong hover:underline">
                      {c.name}
                    </Link>
                  </th>
                  <td className="border-t border-divider px-4 py-2 text-right whitespace-nowrap">
                    {c.status ? <UnitStatusBadge status={c.status as never} /> : `${n(c.countedUnits)} / ${n(c.totalUnits)}`}
                  </td>
                  {parties.map((p) => (
                    <td key={p.acronym} className="border-t border-divider px-4 py-2 text-right">
                      {c.countedUnits ? n(c.partyVotes[p.acronym] ?? 0) : '–'}
                    </td>
                  ))}
                  <td className="border-t border-divider px-4 py-2 text-right">{c.countedUnits ? n(c.totalValid) : '–'}</td>
                  {hasComparisons && (
                    <td className="border-t border-divider px-4 py-2 whitespace-nowrap">
                      {c.comparison && <ComparisonBadge status={c.comparison.status} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function LiveResultsPage(props: PageProps<'/results/elections/[id]'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Suspense fallback={<p role="status" className="text-ink-muted">Loading results…</p>}>
        <Dashboard {...props} />
      </Suspense>
    </div>
  );
}
