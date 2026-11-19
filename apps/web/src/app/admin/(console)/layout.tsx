import { Suspense } from 'react';
import { ConsoleNav, ConsoleNavFallback } from '@/components/admin/console-nav';
import { SignOutButton } from '@/components/admin/sign-out-button';

/** Console chrome. Each page checks the session itself with requireAdmin(). */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="border-b border-divider bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Suspense fallback={<ConsoleNavFallback />}>
            <ConsoleNav />
          </Suspense>
          <SignOutButton />
        </div>
      </div>
      {children}
    </>
  );
}
