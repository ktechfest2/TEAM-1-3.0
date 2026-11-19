import type { ComparisonStatus, UnitStatus } from '@trustelect/shared';

/**
 * Status is always shown with a word and an icon, never colour alone
 * (design principle: status in words, not only colour).
 */

type Tone = 'match' | 'mismatch' | 'dispute' | 'pending';

const TONE_CLASSES: Record<Tone, string> = {
  match: 'bg-match-bg text-match border-match',
  mismatch: 'bg-mismatch-bg text-mismatch border-mismatch',
  dispute: 'bg-dispute-bg text-dispute border-dispute',
  pending: 'bg-pending-bg text-pending border-pending',
};

const COMPARISON: Record<ComparisonStatus, { label: string; tone: Tone }> = {
  match: { label: 'Match', tone: 'match' },
  match_so_far: { label: 'Match so far', tone: 'match' },
  does_not_match: { label: 'Does not match', tone: 'mismatch' },
  possible_mismatch_low_confidence: { label: 'Possible mismatch (low confidence)', tone: 'dispute' },
  conflicting_declarations: { label: 'Conflicting declarations, under review', tone: 'dispute' },
  awaiting_data: { label: 'Awaiting data', tone: 'pending' },
};

const UNIT: Record<UnitStatus, { label: string; tone: Tone }> = {
  not_confirmed: { label: 'No confirmed result yet', tone: 'pending' },
  counted: { label: 'Counted', tone: 'match' },
  provisional: { label: 'Provisional', tone: 'dispute' },
  disputed: { label: 'Disputed', tone: 'mismatch' },
  resolved: { label: 'Resolved by review', tone: 'match' },
};

function ToneIcon({ tone }: { tone: Tone }) {
  const common = {
    width: '1em',
    height: '1em',
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className: 'shrink-0',
  };
  switch (tone) {
    case 'match':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" />
          <path d="m6.5 10.2 2.3 2.3 4.7-4.9" />
        </svg>
      );
    case 'mismatch':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" />
          <path d="m7.2 7.2 5.6 5.6m0-5.6-5.6 5.6" />
        </svg>
      );
    case 'dispute':
      return (
        <svg {...common}>
          <path d="M10 2.5 18 17H2L10 2.5Z" />
          <path d="M10 8v4m0 2.5v.01" />
        </svg>
      );
    case 'pending':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" />
          <path d="M10 5.5V10l3 2" />
        </svg>
      );
  }
}

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${TONE_CLASSES[tone]}`}
    >
      <ToneIcon tone={tone} />
      {label}
    </span>
  );
}

export function ComparisonBadge({ status }: { status: ComparisonStatus }) {
  return <Badge {...COMPARISON[status]} />;
}

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  return <Badge {...UNIT[status]} />;
}
