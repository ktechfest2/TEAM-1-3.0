'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

const FALLBACK_POLL_MS = 30_000;

/**
 * Keeps the dashboard current: listens to the election's live stream (Server-Sent Events)
 * and re-renders when results change. Falls back to polling if the stream is unavailable.
 */
export function LiveRefresh({ electionId, generatedAt, onChange }: { electionId: string; generatedAt: string; onChange: () => void }) {
  const [mode, setMode] = useState<'connecting' | 'live' | 'polling'>('connecting');

  useEffect(() => {
    let poll: number | undefined;
    const source = new EventSource(apiUrl(`/results/elections/${electionId}/stream`));
    source.addEventListener('open', () => {
      setMode('live');
      window.clearInterval(poll);
    });
    source.addEventListener('update', () => onChange());
    source.addEventListener('error', () => {
      // EventSource reconnects by itself; poll meanwhile so figures never go stale
      setMode('polling');
      window.clearInterval(poll);
      poll = window.setInterval(() => onChange(), FALLBACK_POLL_MS);
    });
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [electionId, onChange]);

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
