import type { Metadata } from 'next';
import { cardClass, PageShell } from '@/components/admin/page-shell';
import { adminFetch, requireAdmin } from '@/lib/admin-session';
import { AddPartyForm } from './add-party-form';

export const metadata: Metadata = { title: 'Parties' };

type Party = { id: number; acronym: string; name: string };

async function Parties() {
  const admin = await requireAdmin();
  const parties = await adminFetch<Party[]>('/admin/parties');
  const canEdit = admin.role === 'system_admin';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <section aria-labelledby="party-list-heading" className={cardClass}>
        <h2 id="party-list-heading" className="border-b border-divider px-5 py-4 text-lg font-semibold">
          Registered parties <span className="text-ink-muted tabular">({parties.length})</span>
        </h2>
        {parties.length === 0 ? (
          <p className="px-5 py-6 text-ink-muted">No parties yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-medium">Acronym</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="border-t border-divider">
                  <th scope="row" className="px-5 py-2.5 text-left font-semibold">{p.acronym}</th>
                  <td className="px-5 py-2.5">{p.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {canEdit ? (
        <section className={`${cardClass} p-5`}>
          <AddPartyForm />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">Only system administrators can add parties.</p>
      )}
    </div>
  );
}

export default function PartiesPage() {
  return (
    <PageShell
      title="Parties"
      description="Parties available for elections. Each election lists the parties on its ballot in ballot order."
    >
      <Parties />
    </PageShell>
  );
}
