'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api';

type Label = 'supported' | 'partly_supported' | 'not_supported' | 'unconfirmed' | 'under_review';
type Report = {
  reference: string;
  typeText: string;
  claim: string;
  label: Label;
  labelText: string;
  channel: string;
  corroboration: number;
  receivedAt: string;
  unitCode: string;
  unitName: string;
  wardName: string;
  lgaName: string;
};
type Lookup = { reference: string; typeText: string; labelText: string; label: Label; unitCode: string; published: boolean; status: string };

const LABEL_CLASS: Record<Label, string> = {
  supported: 'bg-match-bg text-match border-match',
  partly_supported: 'bg-dispute-bg text-dispute border-dispute',
  not_supported: 'bg-mismatch-bg text-mismatch border-mismatch',
  unconfirmed: 'bg-pending-bg text-pending border-pending',
  under_review: 'bg-pending-bg text-pending border-pending',
};

const when = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

function LabelChip({ label, text }: { label: Label; text: string }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-sm font-semibold ${LABEL_CLASS[label]}`}>{text}</span>;
}

function FollowReference() {
  const router = useRouter();
  const ref = useSearchParams().get('ref')?.trim().toUpperCase() ?? '';
  const valid = /^TE-[A-Z0-9]{6}$/.test(ref);
  const q = useApi<Lookup>(valid ? `/incidents/ref/${ref}` : null);
  return (
    <section aria-labelledby="follow-heading" className="grid gap-3 rounded-2xl border border-divider bg-surface p-5">
      <h2 id="follow-heading" className="text-lg font-semibold">Follow a report</h2>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get('ref') ?? '').trim().toUpperCase();
          router.replace(`/incidents?ref=${encodeURIComponent(v)}`);
        }}
      >
        <label htmlFor="ref" className="sr-only">Report number</label>
        <input id="ref" name="ref" defaultValue={ref} placeholder="TE-K7Q2MX" autoComplete="off" spellCheck={false} className="min-h-11 min-w-0 flex-1 rounded-xl border border-border px-3 font-mono uppercase" />
        <button type="submit" className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong">Check</button>
      </form>
      <div aria-live="polite">
        {ref && !valid && <p className="text-mismatch">Report numbers look like TE-K7Q2MX.</p>}
        {valid && q.status === 'loading' && <p className="text-ink-muted">Checking…</p>}
        {valid && q.status === 'error' && <p className="text-mismatch">{q.error.status === 404 ? `No report found with the number ${ref}.` : q.error.message}</p>}
        {q.status === 'ready' && (
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{q.data.reference}</span> · {q.data.typeText} at <span className="font-mono">{q.data.unitCode}</span> ·{' '}
            <LabelChip label={q.data.label} text={q.data.labelText} />
            <span className="text-ink-muted">{q.data.published ? 'Published' : q.data.status === 'hidden' ? 'Not published' : 'Not published yet'}</span>
          </p>
        )}
      </div>
    </section>
  );
}

export function IncidentList() {
  const q = useApi<Report[]>('/incidents?limit=50');
  return (
    <div className="grid gap-6">
      <FollowReference />
      <section aria-labelledby="latest-heading" className="grid gap-3">
        <h2 id="latest-heading" className="text-xl font-semibold">Latest published reports</h2>
        {q.status === 'loading' && <p role="status" className="text-ink-muted">Loading…</p>}
        {q.status === 'error' && <p className="text-mismatch">Reports could not be loaded right now.</p>}
        {q.status === 'ready' && q.data.length === 0 && <p className="text-ink-muted">No reports have been published yet.</p>}
        {q.status === 'ready' && q.data.length > 0 && (
          <ul className="grid gap-3">
            {q.data.map((r) => (
              <li key={r.reference} className="grid gap-2 rounded-2xl border border-divider bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{r.typeText}</h3>
                  <LabelChip label={r.label} text={r.labelText} />
                </div>
                <p>{r.claim}</p>
                <p className="text-sm text-ink-muted">
                  {r.unitName} (<span className="font-mono">{r.unitCode}</span>), {r.wardName}, {r.lgaName} · {when(r.receivedAt)}
                  {r.corroboration > 0 ? ` · also reported by ${r.corroboration} other ${r.corroboration === 1 ? 'person' : 'people'}` : ''}
                  {r.channel === 'whatsapp' ? ' · sent by WhatsApp' : ''} · <span className="font-mono">{r.reference}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
