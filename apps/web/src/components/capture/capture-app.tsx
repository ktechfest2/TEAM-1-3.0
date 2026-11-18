'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Camera } from './camera';
import { flushQueue, queue, type QueuedPhoto } from './queue';
import { QueueList } from './queue-list';
import { VerifyPhone } from './verify-phone';

type Election = { id: string; title: string; status: string };
type Step = 'loading' | 'intro' | 'verify' | 'election' | 'camera' | 'review';
type Coords = { latitude: number; longitude: number; accuracy: number };

const RETRY_MS = 30_000;

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const card = 'rounded-2xl border border-divider bg-surface p-5 sm:p-6';
const primary =
  'inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-60';
const secondary =
  'inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-surface px-5 font-semibold text-ink hover:bg-surface-muted';

export function CaptureApp() {
  const [step, setStep] = useState<Step>('loading');
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [elections, setElections] = useState<Election[] | null>(null);
  const [election, setElection] = useState<Election | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationState, setLocationState] = useState<'off' | 'asking' | 'on' | 'denied'>('off');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; capturedAt: string } | null>(null);
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [needsVerify, setNeedsVerify] = useState(false);

  const refresh = useCallback(async () => setItems(await queue.all()), []);

  const flush = useCallback(async () => {
    const result = await flushQueue(() => void refresh());
    if (result === 'signed-out') setNeedsVerify(true);
    await refresh();
  }, [refresh]);

  // Session check, queue load, and upload when the network comes back
  useEffect(() => {
    queue.all().then(setItems).catch(() => undefined);
    fetch('/api/capture/session')
      .then(async (res) => {
        if (res.ok) {
          setPhoneMasked(((await res.json()) as { phoneMasked: string }).phoneMasked);
          setStep('election');
          void flush();
        } else {
          setStep('intro');
        }
      })
      .catch(() => setStep('intro'));

    const goOnline = () => void flush();
    window.addEventListener('online', goOnline);
    const timer = window.setInterval(() => void flush(), RETRY_MS);
    return () => {
      window.removeEventListener('online', goOnline);
      window.clearInterval(timer);
    };
  }, [flush, refresh]);

  useEffect(() => {
    if (step !== 'election' || elections) return;
    fetch('/api/elections')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Election[]) => setElections(list.filter((e) => e.status === 'active')))
      .catch(() => setElections([]));
  }, [step, elections]);

  // Free the preview image memory
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  function askLocation() {
    if (!('geolocation' in navigator)) return setLocationState('denied');
    setLocationState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocationState('on');
      },
      () => setLocationState('denied'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function savePhoto() {
    if (!photo || !election) return;
    await queue.put({
      clientId: crypto.randomUUID(),
      electionId: election.id,
      electionTitle: election.title,
      blob: photo.blob,
      capturedAt: photo.capturedAt,
      ...(coords ?? {}),
      status: 'waiting',
      attempts: 0,
      createdAt: new Date().toISOString(),
    });
    setPhoto(null);
    setStep('camera');
    await refresh();
    void flush();
  }

  const pending = items.filter((i) => i.status === 'waiting' || i.status === 'uploading').length;

  return (
    <div className="mx-auto grid w-full max-w-lg gap-5 px-4 py-6">
      {!online && (
        <p role="status" className="rounded-xl border border-pending bg-pending-bg px-3 py-2 text-sm font-medium text-pending">
          You are offline. You can still take photos; they will be sent when the network returns.
        </p>
      )}
      {needsVerify && step !== 'verify' && (
        <div role="alert" className="rounded-xl border border-dispute bg-dispute-bg px-3 py-2 text-sm text-dispute">
          Your session has ended, so {pending} photo(s) are waiting.{' '}
          <button type="button" className="font-semibold underline" onClick={() => setStep('verify')}>
            Verify your number again
          </button>{' '}
          to send them.
        </div>
      )}

      {step === 'loading' && <p role="status" className="text-ink-muted">Loading…</p>}

      {step === 'intro' && (
        <section className={card} aria-labelledby="intro-heading">
          <h1 id="intro-heading" className="text-2xl font-bold tracking-tight">Photograph a result poster</h1>
          <p className="mt-2 text-ink-muted">
            After counting, the Presiding Officer pastes the EC60E result poster at the polling unit. Your photo helps
            prove what was announced there.
          </p>
          <h2 className="mt-5 font-semibold">What TrustElect collects</h2>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm">
            <li>Your phone number, to confirm you are a real, separate witness. Stored encrypted and never shown publicly.</li>
            <li>The photo of the poster, with the time it was taken.</li>
            <li>Your location, only if you choose to share it, to show the photo was taken at the polling unit.</li>
          </ul>
          <p className="mt-3 text-sm">
            Read the full <Link href="/privacy" className="font-medium text-brand-strong underline">privacy notice</Link>.
          </p>
          <p className="mt-4 rounded-xl bg-dispute-bg px-3 py-2.5 text-sm text-dispute">
            <strong>Stay safe.</strong> Never put yourself at risk to take a photo. If there is violence, leave and call
            112.
          </p>
          <div className="mt-5">
            <button type="button" className={primary} onClick={() => setStep('verify')}>
              I agree, continue
            </button>
          </div>
        </section>
      )}

      {step === 'verify' && (
        <section className={card} aria-labelledby="verify-heading">
          <h1 id="verify-heading" className="mb-4 text-xl font-bold tracking-tight">Verify your phone</h1>
          <VerifyPhone
            onVerified={(masked) => {
              setPhoneMasked(masked);
              setNeedsVerify(false);
              setStep('election');
              void flush();
            }}
          />
        </section>
      )}

      {step === 'election' && (
        <section className={card} aria-labelledby="election-heading">
          <h1 id="election-heading" className="text-xl font-bold tracking-tight">Which election is this poster for?</h1>
          {phoneMasked && <p className="mt-1 text-sm text-ink-muted">Verified: {phoneMasked}</p>}
          {elections === null ? (
            <p role="status" className="mt-4 text-ink-muted">Loading elections…</p>
          ) : elections.length === 0 ? (
            <p className="mt-4 text-ink-muted">No election is accepting photographs right now.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {elections.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => {
                      setElection(e);
                      setStep('camera');
                    }}
                  >
                    {e.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step === 'camera' && election && (
        <section className="grid gap-4" aria-labelledby="camera-heading">
          <div>
            <h1 id="camera-heading" className="text-xl font-bold tracking-tight">Photograph the EC60E poster</h1>
            <p className="text-sm text-ink-muted">
              {election.title} ·{' '}
              <button type="button" className="font-medium text-brand-strong underline" onClick={() => setStep('election')}>
                change
              </button>
            </p>
          </div>

          <div className="rounded-xl border border-divider bg-surface p-3 text-sm">
            {locationState === 'on' ? (
              <p className="text-match">✓ Location added (accurate to about {Math.round(coords!.accuracy)} m)</p>
            ) : locationState === 'denied' ? (
              <p className="text-ink-muted">Location not shared. Your photo still counts.</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-ink-muted">Sharing your location shows the photo was taken at the polling unit. Optional.</p>
                <button
                  type="button"
                  onClick={askLocation}
                  disabled={locationState === 'asking'}
                  className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-surface-muted"
                >
                  {locationState === 'asking' ? 'Getting location…' : 'Share location'}
                </button>
              </div>
            )}
          </div>

          <Camera
            onCapture={(blob) => {
              setPhoto({ blob, url: URL.createObjectURL(blob), capturedAt: new Date().toISOString() });
              setStep('review');
            }}
          />
        </section>
      )}

      {step === 'review' && photo && (
        <section className="grid gap-4" aria-labelledby="review-heading">
          <h1 id="review-heading" className="text-xl font-bold tracking-tight">Can you read every figure?</h1>
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={photo.url} alt="The photo you just took" className="w-full rounded-2xl border border-divider" />
          <p className="text-sm text-ink-muted">Check that the stamp, the polling unit code and all the numbers are sharp.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={secondary} onClick={() => { setPhoto(null); setStep('camera'); }}>
              Retake
            </button>
            <button type="button" className={primary} onClick={() => void savePhoto()}>
              Send photo
            </button>
          </div>
        </section>
      )}

      <QueueList
        items={items}
        onRemove={async (id) => {
          await queue.remove(id);
          await refresh();
        }}
      />
    </div>
  );
}
