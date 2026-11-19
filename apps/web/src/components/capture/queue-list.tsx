'use client';

import { useState } from 'react';
import type { PhotoCheck, QueuedPhoto } from './queue';

type Badge = { label: string; className: string; icon: string };

const PENDING = 'bg-pending-bg text-pending border-pending';
const MATCH = 'bg-match-bg text-match border-match';
const DISPUTE = 'bg-dispute-bg text-dispute border-dispute';
const MISMATCH = 'bg-mismatch-bg text-mismatch border-mismatch';

function badgeFor(item: QueuedPhoto): Badge {
  if (item.status === 'waiting') return { label: 'Waiting for network', className: PENDING, icon: '◷' };
  if (item.status === 'uploading') return { label: 'Sending…', className: PENDING, icon: '↑' };
  if (item.status === 'failed') return { label: 'Not accepted', className: MISMATCH, icon: '✕' };
  switch (item.check?.status) {
    case 'verified':
      return { label: 'Accepted', className: MATCH, icon: '✓' };
    case 'needs_confirmation':
      return { label: 'Please check', className: DISPUTE, icon: '!' };
    case 'rejected':
      return item.check.retake
        ? { label: 'Please retake', className: DISPUTE, icon: '↻' }
        : { label: 'Not accepted', className: MISMATCH, icon: '✕' };
    default:
      return { label: 'Received, checking…', className: PENDING, icon: '◷' };
  }
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

function Figures({ check }: { check: PhotoCheck }) {
  if (!check.figures) return null;
  const { partyVotes, totalValid, rejected, totalCast } = check.figures;
  return (
    <div className="mt-3 rounded-lg bg-surface-muted p-3">
      {check.unitCode && (
        <p className="text-sm font-medium">
          <span className="font-mono tabular">{check.unitCode}</span> {check.unitName}
        </p>
      )}
      <table className="mt-2 w-full text-sm tabular">
        <caption className="sr-only">Figures read from your photo</caption>
        <tbody>
          {Object.entries(partyVotes).map(([party, votes]) => (
            <tr key={party} className="border-t border-divider first:border-t-0">
              <th scope="row" className="py-1 text-left font-medium">{party}</th>
              <td className="py-1 text-right">{votes.toLocaleString('en-NG')}</td>
            </tr>
          ))}
          <tr className="border-t border-divider text-ink-muted">
            <th scope="row" className="py-1 text-left font-normal">Total valid</th>
            <td className="py-1 text-right">{totalValid.toLocaleString('en-NG')}</td>
          </tr>
          {rejected !== null && (
            <tr className="text-ink-muted">
              <th scope="row" className="py-1 text-left font-normal">Rejected</th>
              <td className="py-1 text-right">{rejected.toLocaleString('en-NG')}</td>
            </tr>
          )}
          {totalCast !== null && (
            <tr className="text-ink-muted">
              <th scope="row" className="py-1 text-left font-normal">Total cast</th>
              <td className="py-1 text-right">{totalCast.toLocaleString('en-NG')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function QueueList({
  items,
  onRemove,
  onRetake,
  onAnswer,
}: {
  items: QueuedPhoto[];
  onRemove: (clientId: string) => void;
  onRetake: () => void;
  onAnswer: (item: QueuedPhoto, confirmed: boolean) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="queue-heading" className="grid gap-3">
      <h2 id="queue-heading" className="text-lg font-semibold">Your photos</h2>
      <ul className="grid gap-2" aria-live="polite">
        {items.map((item) => {
          const b = badgeFor(item);
          const check = item.status === 'sent' ? item.check : undefined;
          return (
            <li key={item.clientId} className="rounded-xl border border-divider bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.electionTitle}</p>
                  <p className="text-sm text-ink-muted">Taken at {time(item.capturedAt)}</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${b.className}`}>
                  <span aria-hidden="true">{b.icon}</span>
                  {b.label}
                </span>
              </div>

              {check?.status === 'verified' && <Figures check={check} />}

              {check?.status === 'needs_confirmation' && (
                <div className="mt-3 grid gap-2">
                  <p className="text-sm text-dispute">{check.reason}</p>
                  <Figures check={check} />
                  <p className="text-sm font-medium">Do these figures match the poster exactly?</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[true, false].map((answer) => (
                      <button
                        key={String(answer)}
                        type="button"
                        disabled={busy === item.clientId}
                        onClick={async () => {
                          setBusy(item.clientId);
                          setAnswerError(await onAnswer(item, answer));
                          setBusy(null);
                        }}
                        className={
                          answer
                            ? 'min-h-11 rounded-lg bg-brand px-3 font-semibold text-brand-ink hover:bg-brand-strong'
                            : 'min-h-11 rounded-lg border border-border px-3 font-semibold hover:bg-surface-muted'
                        }
                      >
                        {answer ? 'Yes, they match' : 'No, they were read wrongly'}
                      </button>
                    ))}
                  </div>
                  {answerError && <p role="alert" className="text-sm text-mismatch">{answerError}</p>}
                </div>
              )}

              {check?.status === 'rejected' && (
                <div className="mt-2 grid gap-2 text-sm">
                  <p className={check.retake ? 'text-dispute' : 'text-mismatch'}>{check.reason}</p>
                  {check.retake && (
                    <button type="button" onClick={onRetake} className="justify-self-start font-semibold text-brand-strong underline">
                      Take the photo again
                    </button>
                  )}
                </div>
              )}

              {item.status === 'sent' && item.sha256 && check?.status !== 'rejected' && (
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
