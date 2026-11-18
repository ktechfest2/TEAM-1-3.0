import { CONFIDENCE_THRESHOLDS, UNOFFICIAL_LABEL } from '@trustelect/shared';
import { ComparisonBadge } from '@/components/status-badge';
import { UnitSearch } from '@/components/unit-search';

const STEPS = [
  {
    title: 'Photograph the poster',
    body: 'After counting, voters photograph the EC60E result poster at their polling unit with the live camera. Old or forwarded photos cannot be used.',
  },
  {
    title: 'Every photo is checked',
    body: 'TrustElect confirms it is a genuine, stamped EC60E for this election, reads the figures and checks that they add up.',
  },
  {
    title: 'Independent witnesses agree',
    body: `Confidence grows as different people photograph the same figures: ${CONFIDENCE_THRESHOLDS.high} or more independent witnesses means high confidence. Disagreements go to human review.`,
  },
  {
    title: 'Counted from the unit up',
    body: 'Results are added up by ward, LGA, state and nation, always showing how many polling units are covered.',
  },
  {
    title: 'Compared with what is declared',
    body: 'When results are officially declared, TrustElect shows where they match what voters recorded, where they do not, and where disputes exist.',
  },
];

export default function Home() {
  return (
    <>
      <section className="border-b border-divider bg-surface">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-12 sm:py-16">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-divider bg-surface-muted px-3 py-1 text-sm font-medium text-ink-muted">
            {UNOFFICIAL_LABEL}
          </p>
          <h1 className="max-w-3xl text-[clamp(2rem,1.4rem+2.4vw,3.25rem)] font-bold tracking-tight">
            Is what was declared what was pasted on the wall?
          </h1>
          <p className="max-w-[60ch] text-lg text-ink-muted">
            TrustElect turns voters&apos; photographs of polling unit result posters into a public,
            tamper-evident record, and checks declared results against it.
          </p>
          <div className="max-w-xl rounded-xl border border-divider bg-canvas p-4 sm:p-5">
            <UnitSearch />
          </div>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" className="mx-auto max-w-5xl px-4 py-12">
        <h2 id="how-heading" className="text-2xl font-bold">
          How it works
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-divider bg-surface p-5">
              <span className="text-sm font-semibold text-brand tabular">Step {i + 1}</span>
              <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="status-heading" className="border-t border-divider bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 id="status-heading" className="text-2xl font-bold">
            What the comparison labels mean
          </h2>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <dt>
                <ComparisonBadge status="match" />
              </dt>
              <dd className="text-ink-muted">
                The declared figures agree with what voters recorded for every covered polling unit.
              </dd>
            </div>
            <div className="grid gap-2">
              <dt>
                <ComparisonBadge status="does_not_match" />
              </dt>
              <dd className="text-ink-muted">
                Voters&apos; confirmed figures are inconsistent with the declaration, for example a
                party has more confirmed votes than it was declared to have in total.
              </dd>
            </div>
            <div className="grid gap-2">
              <dt>
                <ComparisonBadge status="possible_mismatch_low_confidence" />
              </dt>
              <dd className="text-ink-muted">
                A difference that rests only on units with a single witness. Treated with caution.
              </dd>
            </div>
            <div className="grid gap-2">
              <dt>
                <ComparisonBadge status="awaiting_data" />
              </dt>
              <dd className="text-ink-muted">
                No approved declaration yet, or no confirmed polling units in this area.
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
