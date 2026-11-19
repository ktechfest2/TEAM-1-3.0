import Image from 'next/image';
import logo from '../../../public/brand/trustelect-logo.png';

/** Centered card used by the sign-in and two-factor screens. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <Image src={logo} alt="TrustElect" width={132} className="mx-auto mb-6 h-auto" priority />
      <div className="card-shadow rounded-2xl border border-divider bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <div className="mt-2 text-ink-muted">{description}</div>}
        <div className="mt-6">{children}</div>
      </div>
      <p className="mt-6 text-center text-sm text-ink-subtle">
        Restricted to authorised TrustElect staff. Every action is recorded.
      </p>
    </div>
  );
}

export const inputClass =
  'block min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-[max(1rem,1em)] text-ink focus:border-brand user-invalid:border-mismatch';

export const primaryButtonClass =
  'inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong disabled:cursor-progress disabled:opacity-70';

export function FormError({ message }: { message: string | null }) {
  return (
    <div role="alert" className="empty:hidden">
      {message && (
        <p className="flex gap-2 rounded-xl border border-mismatch bg-mismatch-bg px-3 py-2.5 text-sm font-medium text-mismatch">
          <span aria-hidden="true">✕</span>
          {message}
        </p>
      )}
    </div>
  );
}
