import { UNOFFICIAL_LABEL } from '@trustelect/shared';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-divider bg-surface">
      <div className="mx-auto grid max-w-5xl gap-3 px-4 py-6 text-sm text-ink-muted">
        <p>
          <strong className="text-ink">{UNOFFICIAL_LABEL}.</strong> TrustElect shows results
          photographed by voters from EC60E posters already pasted at polling units. It is not
          INEC and does not declare winners. Official results are declared by INEC.
        </p>
        <p>
          TrustElect is neutral: the same rules apply to every party, parties are listed in ballot
          order, and no party colours are used. No advertising and no third-party trackers.
        </p>
      </div>
    </footer>
  );
}
