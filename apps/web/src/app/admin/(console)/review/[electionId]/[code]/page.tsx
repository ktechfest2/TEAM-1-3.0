import type { Metadata } from 'next';
import Link from 'next/link';
import { UnitStatusBadge } from '@/components/status-badge';
import { cardClass, PageShell } from '@/components/admin/page-shell';
import { adminFetch, requireAdmin } from '@/lib/admin-session';
import { FLAG_LABELS } from '../../flags';
import { ResolveForm } from './resolve-form';

export const metadata: Metadata = { title: 'Review polling unit' };

type Figures = { partyVotes: Record<string, number>; totalValid: number; rejected: number | null; totalCast: number | null };

type Detail = {
  unit: { code: string; name: string; wardName: string; lgaName: string; stateName: string };
  election: { id: string; title: string };
  parties: { acronym: string; name: string }[];
  result: {
    status: 'not_confirmed' | 'counted' | 'provisional' | 'disputed' | 'resolved';
    countedVersionId: string | null;
    witnessCount: number;
    confidence: string | null;
    flags: string[];
    resolutionReason: string | null;
  } | null;
  versions: { id: string; figures: Figures; witnessCount: number; stampedWitnessCount: number; strongWitnessCount: number; confidence: string | null }[];
  photos: {
    id: string;
    versionId: string | null;
    status: string;
    evidenceStrength: 'strong' | 'standard' | 'low' | null;
    receivedAt: string;
    hasImage: boolean;
    reason: string | null;
    voterConfirmed: boolean;
  }[];
};

const STRENGTH: Record<string, string> = { strong: 'Stamp + code match', standard: 'Stamp', low: 'No stamp' };

function time(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

async function UnitReview({ params }: { params: PageProps<'/admin/review/[electionId]/[code]'>['params'] }) {
  const admin = await requireAdmin();
  const { electionId, code } = await params;
  const d = await adminFetch<Detail>(`/admin/review/elections/${encodeURIComponent(electionId)}/units/${encodeURIComponent(code)}`);
  const canResolve = admin.role === 'reviewer' || admin.role === 'system_admin';
  const versionLabel = (v: Detail['versions'][number], i: number) =>
    `Version ${String.fromCharCode(65 + i)}: ${d.parties.map((p) => `${p.acronym} ${v.figures.partyVotes[p.acronym] ?? 0}`).join(', ')} (${v.witnessCount} witnesses)`;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-ink-muted tabular">{d.unit.code}</p>
          <h2 className="text-xl font-semibold">{d.unit.name}</h2>
          <p className="text-sm text-ink-muted">
            {d.unit.wardName} ward · {d.unit.lgaName} · {d.unit.stateName} · {d.election.title}
          </p>
        </div>
        {d.result && <UnitStatusBadge status={d.result.status} />}
      </div>

      {d.result?.flags.length ? (
        <p className="rounded-xl border border-dispute bg-dispute-bg px-4 py-3 text-sm text-dispute">
          {d.result.flags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}
        </p>
      ) : null}
      {d.result?.resolutionReason && (
        <p className="rounded-xl border border-divider bg-surface px-4 py-3 text-sm">
          <strong>Previous decision:</strong> {d.result.resolutionReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {d.versions.map((v, i) => {
          const counted = d.result?.countedVersionId === v.id;
          const photos = d.photos.filter((p) => p.versionId === v.id);
          return (
            <section key={v.id} className={`${cardClass} ${counted ? 'border-2 border-brand' : ''}`} aria-labelledby={`v-${v.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-3">
                <h3 id={`v-${v.id}`} className="font-semibold">Version {String.fromCharCode(65 + i)}</h3>
                <p className="text-sm text-ink-muted">
                  {v.witnessCount} witnesses · {v.stampedWitnessCount} with stamp · {v.confidence ?? '–'} confidence
                  {counted && <strong className="ml-2 text-brand-strong">Counted</strong>}
                </p>
              </div>
              <table className="w-full text-sm tabular">
                <tbody>
                  {d.parties.map((p) => (
                    <tr key={p.acronym} className="border-t border-divider first:border-t-0">
                      <th scope="row" className="px-5 py-1.5 text-left font-medium">{p.acronym}</th>
                      <td className="px-5 py-1.5 text-right">{v.figures.partyVotes[p.acronym] ?? 0}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-divider text-ink-muted">
                    <th scope="row" className="px-5 py-1.5 text-left font-normal">Total valid</th>
                    <td className="px-5 py-1.5 text-right">{v.figures.totalValid}</td>
                  </tr>
                </tbody>
              </table>
              <ul className="grid grid-cols-2 gap-3 border-t border-divider p-4 sm:grid-cols-3">
                {photos.map((p) => (
                  <li key={p.id} className="grid gap-1 text-xs text-ink-muted">
                    {p.hasImage ? (
                      <a href={`/api/admin/review/photos/${p.id}`} target="_blank" rel="noopener">
                        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated evidence image */}
                        <img
                          src={`/api/admin/review/photos/${p.id}`}
                          alt={`Photo received ${time(p.receivedAt)}`}
                          loading="lazy"
                          className="aspect-[3/4] w-full rounded-lg border border-divider object-cover"
                        />
                      </a>
                    ) : (
                      <div className="grid aspect-[3/4] place-items-center rounded-lg border border-divider">No image</div>
                    )}
                    <span>{time(p.receivedAt)}</span>
                    <span>
                      {p.evidenceStrength ? STRENGTH[p.evidenceStrength] : '–'}
                      {p.voterConfirmed ? ' · voter confirmed figures' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {canResolve && d.versions.length > 0 && (
        <section className={`${cardClass} p-5`}>
          <ResolveForm
            electionId={d.election.id}
            unitCode={d.unit.code}
            versions={d.versions.map((v, i) => ({ id: v.id, label: versionLabel(v, i) }))}
          />
        </section>
      )}
      <p>
        <Link href="/admin/review" className="text-sm font-medium text-brand-strong hover:underline">
          Back to the review queue
        </Link>
      </p>
    </div>
  );
}

export default function UnitReviewPage(props: PageProps<'/admin/review/[electionId]/[code]'>) {
  return (
    <PageShell title="Review polling unit" description="Compare the versions and the photos behind them, then record which version the evidence supports.">
      <UnitReview params={props.params} />
    </PageShell>
  );
}
