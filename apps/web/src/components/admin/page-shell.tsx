import { Suspense } from 'react';

/** Page heading plus a Suspense boundary for content that reads the session. */
export function PageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {description && <p className="mt-1 max-w-[70ch] text-ink-muted">{description}</p>}
      <div className="mt-6">
        <Suspense fallback={<p role="status" className="text-ink-muted">Loading…</p>}>{children}</Suspense>
      </div>
    </div>
  );
}

export const cardClass = 'rounded-2xl border border-divider bg-surface';
