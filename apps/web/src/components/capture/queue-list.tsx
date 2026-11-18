'use client';

import type { QueuedPhoto } from './queue';

const STATUS: Record<QueuedPhoto['status'], { label: string; className: string; icon: string }> = {
  waiting: { label: 'Waiting for network', className: 'bg-pending-bg text-pending border-pending', icon: '◷' },
  uploading: { label: 'Sending…', className: 'bg-pending-bg text-pending border-pending', icon: '↑' },
  sent: { label: 'Received', className: 'bg-match-bg text-match border-match', icon: '✓' },
  failed: { label: 'Not accepted', className: 'bg-mismatch-bg text-mismatch border-mismatch', icon: '✕' },
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

export function QueueList({ items, onRemove }: { items: QueuedPhoto[]; onRemove: (clientId: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="queue-heading" className="grid gap-3">
      <h2 id="queue-heading" className="text-lg font-semibold">Your photos</h2>
      <ul className="grid gap-2" aria-live="polite">
        {items.map((item) => {
          const s = STATUS[item.status];
          return (
            <li key={item.clientId} className="rounded-xl border border-divider bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.electionTitle}</p>
                  <p className="text-sm text-ink-muted">Taken at {time(item.capturedAt)}</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${s.className}`}>
                  <span aria-hidden="true">{s.icon}</span>
                  {s.label}
                </span>
              </div>
              {item.status === 'sent' && item.sha256 && (
                <p className="mt-2 break-all font-mono text-xs text-ink-subtle">Receipt: {item.sha256.slice(0, 16)}…</p>
              )}
              {item.status === 'failed' && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-mismatch">{item.lastError}</span>
                  <button type="button" onClick={() => onRemove(item.clientId)} className="font-medium text-brand-strong hover:underline">
                    Remove
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
