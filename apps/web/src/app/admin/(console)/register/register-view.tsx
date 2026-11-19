'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cardClass } from '@/components/admin/page-shell';
import { useAdminApi } from '@/lib/admin-session';

type Summary = { states: number; lgas: number; wards: number; pollingUnits: number };
type Area = { code: string; name: string; lgas?: number; wards?: number; pollingUnits?: number; registeredVoters?: number | null };

const CODE = /^[\d-]{2,12}$/;

function str(v: string | null) {
  return v && CODE.test(v) ? v : undefined;
}

type Level = { title: string; path: string; child?: 'lga' | 'ward' | 'unit'; countLabel?: string; countKey?: keyof Area };

export function Register() {
  const sp = useSearchParams();
  const state = str(sp.get('state'));
  const lga = str(sp.get('lga'));
  const ward = str(sp.get('ward'));

  let base: Level = { title: 'States', path: '/geo/states', child: 'lga', countLabel: 'LGAs', countKey: 'lgas' };
  if (ward) {
    base = { title: `Polling units in ward ${ward}`, path: `/geo/wards/${ward}/units`, countLabel: 'Registered voters', countKey: 'registeredVoters' };
  } else if (lga) {
    base = { title: `Wards in LGA ${lga}`, path: `/geo/lgas/${lga}/wards`, child: 'unit', countLabel: 'Polling units', countKey: 'pollingUnits' };
  } else if (state) {
    base = { title: `LGAs in state ${state}`, path: `/geo/states/${state}/lgas`, child: 'ward', countLabel: 'Wards', countKey: 'wards' };
  }
  const s = useAdminApi<Summary>('/geo/summary');
  const q = useAdminApi<Area[]>(base.path);
  if (q.status === 'loading') return <p role="status" className="text-ink-muted">Loading…</p>;
  if (q.status === 'error') return <p className="text-mismatch">{q.error.message}</p>;
  if (s.status !== 'ready') return null;
  const summary = s.data;
  const level = { ...base, rows: q.data };

  const linkFor = (code: string) =>
    level.child === 'lga' ? `/admin/register?state=${code}` : level.child === 'ward' ? `/admin/register?lga=${code}` : level.child === 'unit' ? `/admin/register?ward=${code}` : null;

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
