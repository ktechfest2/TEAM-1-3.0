import type { Metadata } from 'next';
import Link from 'next/link';
import { cardClass, PageShell } from '@/components/admin/page-shell';
import { adminFetch, requireAdmin } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Polling units' };

type Summary = { states: number; lgas: number; wards: number; pollingUnits: number };
type Area = { code: string; name: string; lgas?: number; wards?: number; pollingUnits?: number; registeredVoters?: number | null };

const CODE = /^[\d-]{2,12}$/;

function str(v: string | string[] | undefined) {
  return typeof v === 'string' && CODE.test(v) ? v : undefined;
}

async function Register({ searchParams }: { searchParams: PageProps<'/admin/register'>['searchParams'] }) {
  await requireAdmin();
  const sp = await searchParams;
  const state = str(sp.state);
  const lga = str(sp.lga);
  const ward = str(sp.ward);

  const summary = await adminFetch<Summary>('/geo/summary');
  let level: { title: string; rows: Area[]; child?: 'lga' | 'ward' | 'unit'; countLabel?: string; countKey?: keyof Area } =
    { title: 'States', rows: await adminFetch<Area[]>('/geo/states'), child: 'lga', countLabel: 'LGAs', countKey: 'lgas' };
  if (ward) {
    level = { title: `Polling units in ward ${ward}`, rows: await adminFetch<Area[]>(`/geo/wards/${ward}/units`), countLabel: 'Registered voters', countKey: 'registeredVoters' };
  } else if (lga) {
    level = { title: `Wards in LGA ${lga}`, rows: await adminFetch<Area[]>(`/geo/lgas/${lga}/wards`), child: 'unit', countLabel: 'Polling units', countKey: 'pollingUnits' };
  } else if (state) {
    level = { title: `LGAs in state ${state}`, rows: await adminFetch<Area[]>(`/geo/states/${state}/lgas`), child: 'ward', countLabel: 'Wards', countKey: 'wards' };
  }

  const linkFor = (code: string) =>
    level.child === 'lga' ? `?state=${code}` : level.child === 'ward' ? `?lga=${code}` : level.child === 'unit' ? `?ward=${code}` : null;

  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['States', summary.states],
            ['LGAs', summary.lgas],
            ['Wards', summary.wards],
            ['Polling units', summary.pollingUnits],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className={`${cardClass} px-4 py-3`}>
            <dt className="text-sm text-ink-muted">{label}</dt>
            <dd className="text-2xl font-bold tabular">{n.toLocaleString('en-NG')}</dd>
          </div>
        ))}
      </dl>

      {summary.pollingUnits < 1000 && (
        <p className="rounded-xl border border-dispute bg-dispute-bg px-4 py-3 text-sm text-dispute">
          <strong>Partial register loaded.</strong> Nigeria has 176,846 polling units. Import the full register with{' '}
          <code className="font-mono">npm run register:import</code>.
        </p>
      )}

      <section aria-labelledby="area-heading" className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-4">
          <h2 id="area-heading" className="text-lg font-semibold">{level.title}</h2>
          {(state || lga || ward) && (
            <Link href="/admin/register" className="text-sm font-medium text-brand-strong hover:underline">
              Back to all states
            </Link>
          )}
        </div>
        {level.rows.length === 0 ? (
          <p className="px-5 py-6 text-ink-muted">Nothing imported for this area yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-medium">Code</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">{level.countLabel}</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {level.rows.map((r) => {
                const href = linkFor(r.code);
                const n = level.countKey ? r[level.countKey] : undefined;
                return (
                  <tr key={r.code} className="border-t border-divider">
                    <td className="px-5 py-2.5 font-mono">{r.code}</td>
                    <th scope="row" className="px-5 py-2.5 text-left font-medium">
                      {href && n ? (
                        <Link href={href} className="text-brand-strong hover:underline">{r.name}</Link>
                      ) : (
                        r.name
                      )}
                    </th>
                    <td className="px-5 py-2.5 text-right">{n == null ? '–' : Number(n).toLocaleString('en-NG')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default function RegisterPage(props: PageProps<'/admin/register'>) {
  return (
    <PageShell
      title="Polling units"
      description="INEC's polling unit register: every unit's code and its ward, LGA and state. Used to check unit codes on posters and to add results up."
    >
      <Register searchParams={props.searchParams} />
    </PageShell>
  );
}
