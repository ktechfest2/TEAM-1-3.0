import Link from 'next/link';
import { CONFIDENCE_THRESHOLDS } from '@trustelect/shared';
import { ExampleResultCard } from '@/components/example-result-card';
import { HeroVideo } from '@/components/hero-video';
import { ComparisonBadge } from '@/components/status-badge';
import { UnitSearch } from '@/components/unit-search';

const ASSURANCES = [
  {
    title: 'Live photos only',
    body: 'Taken on the spot with the camera. No uploads from galleries or forwarded chats.',
    icon: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  },
  {
    title: 'Every form checked',
    body: 'Genuine, stamped EC60E for this election, with the arithmetic verified.',
    icon: 'M6 3h9l4 4v14H6V3Zm3 10 2 2 4-4',
  },
  {
    title: 'Independent witnesses',
    body: 'Confidence comes from different people recording the same figures.',
    icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 3-5 6-5s6 2 6 5m-1-4.6c1-.3 2-.4 3-.4 3 0 6 2 6 5',
  },
  {
    title: 'Tamper-evident record',
    body: 'Every photo and decision is chained by hash. Any later change shows.',
    icon: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11Zm7 4v2',
  },
];

const STEPS = [
  {
    title: 'Photograph the poster',
    body: 'After counting, voters photograph the EC60E result poster at their polling unit.',
  },
  {
    title: 'TrustElect checks it',
    body: 'The form, the stamp and the arithmetic are verified before anything is counted.',
  },
  {
    title: 'Witnesses agree',
    body: `${CONFIDENCE_THRESHOLDS.high} or more independent witnesses with the same figures means high confidence.`,
  },
  {
    title: 'Counted from the unit up',
    body: 'Ward, LGA, state and national totals, always showing how many units are covered.',
  },
  {
    title: 'Compared with declarations',
    body: 'See where declared results match what voters recorded, and where they do not.',
  },
];

function OutlineIcon({ d }: { d: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      {/* Hero: full-screen film with the headline and the two main actions */}
      <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden bg-[#06110c] text-white">
        <HeroVideo />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgb(3_10_7/0.92)_0%,rgb(3_10_7/0.55)_38%,rgb(3_10_7/0)_70%),linear-gradient(to_right,rgb(3_10_7/0.55)_0%,rgb(3_10_7/0)_60%)]"
        />
        <div className="mx-auto flex min-h-[calc(100svh-var(--header-height)-6px)] max-w-6xl flex-col justify-end px-4 portrait:max-sm:justify-start pt-[calc(56.25vw+1.5rem)] pb-14 sm:px-6 sm:pt-24 sm:pb-16 landscape:pt-24">
          <div className="grid max-w-2xl gap-5">
            <h1 id="hero-heading" className="text-[clamp(2.25rem,1.6rem+2.6vw,3.75rem)] font-bold tracking-tight text-white">
              Every result, <span className="text-[#5fd39a]">backed by evidence.</span>
            </h1>
            <p className="max-w-[54ch] text-lg text-white/85">
              Voters photograph the result poster at their polling unit. TrustElect verifies each photo, counts results
              from the unit up, and shows whether declared results match what was pasted on the wall.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/capture"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-lg font-semibold text-brand-ink hover:bg-brand-strong"
              >
                <OutlineIcon d="M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                Photograph a result poster
              </Link>
              <Link
                href="/results/elections"
                className="inline-flex min-h-14 items-center justify-center rounded-xl border border-white/60 px-6 text-lg font-semibold text-white hover:bg-white/10"
              >
                See live results
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Send a result, or look one up */}
      <section aria-label="Send or find a result" className="bg-surface">
        <div className="mx-auto grid max-w-6xl items-start gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <div className="grid gap-3 rounded-2xl border-2 border-brand bg-surface-tint p-5">
            <div>
              <h2 className="text-lg font-bold">At a polling unit after counting?</h2>
              <p className="text-ink-muted">
                Photograph the EC60E result poster. Every independent photo makes the record stronger.
              </p>
            </div>
            <Link
              href="/capture"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-lg font-semibold text-brand-ink hover:bg-brand-strong"
            >
              <OutlineIcon d="M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
              Photograph a result poster
            </Link>
          </div>
          <div className="grid gap-4 rounded-2xl border border-divider bg-surface p-5">
            <UnitSearch />
            <p className="text-sm text-ink-muted">
              Saw a problem at a polling unit?{' '}
              <Link href="/capture/report" className="font-semibold text-brand-strong hover:underline">Report an incident</Link> with a photo, or{' '}
              <Link href="/incidents" className="font-semibold text-brand-strong hover:underline">see published reports</Link>.
            </p>
          </div>
        </div>
      </section>

      {/* What a result looks like */}
      <section aria-labelledby="example-heading" className="bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-3">
            <p className="text-sm font-semibold text-verified">What you see</p>
            <h2 id="example-heading" className="text-3xl font-bold tracking-tight">Every figure shows how sure we are</h2>
            <p className="max-w-[52ch] text-ink-muted">
              Each polling unit result shows how many independent witnesses photographed the same figures, whether the
              poster was stamped, and how it compares with what was officially declared.
            </p>
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-lg">
            <ExampleResultCard />
          </div>
        </div>
      </section>

      {/* Assurances */}
      <section aria-labelledby="assurance-heading" className="border-y border-divider bg-surface-muted">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="assurance-heading" className="sr-only">
            Why you can rely on TrustElect
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ASSURANCES.map((a) => (
              <li key={a.title} className="rounded-2xl border border-divider bg-surface p-5">
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-surface-tint text-brand-strong">
                  <OutlineIcon d={a.icon} />
                </span>
                <h3 className="mt-4 font-semibold">{a.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{a.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" aria-labelledby="how-heading" className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-verified">How it works</p>
            <h2 id="how-heading" className="mt-2 text-3xl font-bold tracking-tight">
              From the polling unit wall to a public record
            </h2>
          </div>
          <ol className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid content-start gap-2 border-t-2 border-brand pt-4">
                <span className="text-sm font-bold text-brand-strong tabular">0{i + 1}</span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-sm text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Comparison labels */}
      <section aria-labelledby="labels-heading" className="border-t border-divider bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-verified">Reading the results</p>
            <h2 id="labels-heading" className="mt-2 text-3xl font-bold tracking-tight">
              Clear labels, never guesses
            </h2>
            <p className="mt-3 text-ink-muted">
              TrustElect never calls a result rigged or fake. It shows what the evidence supports.
            </p>
          </div>
          <dl className="mt-10 grid gap-4 sm:grid-cols-2">
            {(
              [
                ['match', 'Declared figures agree with what voters recorded in every covered polling unit.'],
                ['does_not_match', 'Confirmed figures are inconsistent with the declaration, for example more confirmed votes than declared.'],
                ['possible_mismatch_low_confidence', 'A difference that rests only on single-witness units. Treated with caution.'],
                ['awaiting_data', 'No approved declaration yet, or no confirmed polling units in this area.'],
              ] as const
            ).map(([status, text]) => (
              <div key={status} className="grid gap-3 rounded-2xl border border-divider p-5">
                <dt>
                  <ComparisonBadge status={status} />
                </dt>
                <dd className="text-ink-muted">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Call to action */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-brand-strong px-6 py-10 text-brand-ink sm:px-10">
            <div className="max-w-xl">
              <h2 className="text-2xl font-bold tracking-tight">Check your polling unit</h2>
              <p className="mt-2">
                Enter the code on your voter&apos;s card to see what voters recorded.
              </p>
            </div>
            <Link
              href="/results"
              className="inline-flex min-h-12 items-center rounded-xl bg-surface px-6 font-semibold text-brand-strong hover:bg-surface-tint"
            >
              Check a result
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
