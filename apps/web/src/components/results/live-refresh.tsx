'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const FALLBACK_POLL_MS = 30_000;

/**
 * Keeps the dashboard current: listens to the election's live stream (Server-Sent Events)
 * and re-renders when results change. Falls back to polling if the stream is unavailable.
 */
export function LiveRefresh({ electionId, generatedAt }: { electionId: string; generatedAt: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'connecting' | 'live' | 'polling'>('connecting');

  useEffect(() => {
    let poll: number | undefined;
    const source = new EventSource(`/api/results/elections/${electionId}/stream`);
    source.addEventListener('open', () => {
      setMode('live');
      window.clearInterval(poll);
    });
    source.addEventListener('update', () => router.refresh());
    source.addEventListener('error', () => {
      // EventSource reconnects by itself; poll meanwhile so figures never go stale
      setMode('polling');
      window.clearInterval(poll);
      poll = window.setInterval(() => router.refresh(), FALLBACK_POLL_MS);
    });
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [electionId, router]);

  const time = new Date(generatedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Lagos' });
  return (
    <p className="inline-flex items-center gap-2 text-sm text-ink-muted" role="status">
      <span
        aria-hidden="true"
        className={`inline-block size-2.5 rounded-full ${mode === 'live' ? 'bg-match' : 'bg-pending'}`}
      />
      {mode === 'live' ? 'Live' : mode === 'polling' ? 'Reconnecting, refreshing every 30 s' : 'Connecting'} · updated {time}
    </p>
  );
}
