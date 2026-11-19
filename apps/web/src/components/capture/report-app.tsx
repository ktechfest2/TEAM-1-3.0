'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { parseUnitCode } from '@trustelect/shared';
import { apiUrl, authHeaders, describeError, sessionToken } from '@/lib/api';
import { Camera } from './camera';
import { EnterPhone } from './enter-phone';
import { VerifyPhone } from './verify-phone';

const TYPES = [
  ['late_officials', 'Late officials or materials'],
  ['bvas_problem', 'BVAS problems'],
  ['vote_buying', 'Vote buying'],
  ['intimidation_violence', 'Intimidation or violence'],
  ['ballot_snatching', 'Ballot snatching'],
  ['missing_ec60e', 'Missing EC60E poster'],
  ['other', 'Something else'],
] as const;
type Type = (typeof TYPES)[number][0];
const DANGER = new Set<Type>(['intimidation_violence', 'ballot_snatching']);

const card = 'rounded-2xl border border-divider bg-surface p-5 sm:p-6';
const field = 'block min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-[max(1rem,1em)] text-ink focus:border-brand';

type Step = 'loading' | 'sign-in' | 'details' | 'camera' | 'review' | 'sending' | 'done';

function Emergency() {
  return (
    <p role="alert" className="rounded-xl border-2 border-mismatch bg-mismatch-bg px-4 py-3 font-semibold text-mismatch">
      If you or anyone is in danger, move to safety and call <a href="tel:112" className="underline">112</a> now. Tell the police at the polling unit.
    </p>
  );
}

/** Incident report (INC-01, INC-02): live photo, polling unit, type and a short claim; the sender is never shown. */
export function ReportApp() {
  const [step, setStep] = useState<Step>('loading');
  const [smsMode, setSmsMode] = useState(false);
  const [type, setType] = useState<Type | null>(null);
  const [unit, setUnit] = useState('');
  const [claim, setClaim] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; capturedAt: string } | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ reference: string; emergency: boolean } | null>(null);

  useEffect(() => {
    fetch(apiUrl('/capture/config'))
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { phoneVerification?: string } | null) => setSmsMode(c?.phoneVerification === 'sms'))
      .catch(() => undefined);
    fetch(apiUrl('/capture/session'), { headers: authHeaders('voter') })
      .then((res) => {
        if (res.status === 401) sessionToken.clear('voter');
        setStep(res.ok ? 'details' : 'sign-in');
      })
      .catch(() => setStep('sign-in'));
  }, []);
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  async function send() {
    if (!photo || !type) return;
    setStep('sending');
    setError(null);
    const q = new URLSearchParams({ type, unitCode: unit, claim, clientId: crypto.randomUUID(), capturedAt: photo.capturedAt });
    if (coords) {
      q.set('lat', String(coords.latitude));
      q.set('lng', String(coords.longitude));
      q.set('accuracy', String(Math.round(coords.accuracy)));
    }
    try {
      const res = await fetch(apiUrl(`/incidents?${q}`), {
        method: 'POST',
        headers: { 'content-type': photo.blob.type || 'image/jpeg', ...authHeaders('voter') },
        body: photo.blob,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionToken.clear('voter');
        return setStep('sign-in');
      }
      if (!res.ok) {
        setError(describeError(res.status, data));
        return setStep('review');
      }
      setReceipt(data as { reference: string; emergency: boolean });
      setStep('done');
    } catch {
      setError('Could not send the report. Check your connection and try again.');
      setStep('review');
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Report an incident</h1>
        <p className="mt-1 text-ink-muted">
          With a photo you take now. Reports are checked and labelled; serious ones are checked by a person before anything is published. Your number is never shown.
        </p>
      </div>
      {type && DANGER.has(type) && step !== 'done' && <Emergency />}

      {step === 'loading' && <p role="status" className="text-ink-muted">Loading…</p>}

      {step === 'sign-in' && (
        <section className={card} aria-labelledby="sign-heading">
          <h2 id="sign-heading" className="mb-3 text-lg font-semibold">Your phone number</h2>
          {smsMode ? <VerifyPhone onVerified={() => setStep('details')} /> : <EnterPhone onStarted={() => setStep('details')} />}
        </section>
      )}

      {step === 'details' && (
        <form
          className={`${card} grid gap-5`}
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const parsed = parseUnitCode(unit);
            if (!type) return setError('Choose what you are reporting.');
            if (!parsed) return setError('Enter the polling unit code in the format 24-05-01-003.');
            const res = await fetch(apiUrl(`/geo/units/${parsed.unit}`)).catch(() => null);
            if (res?.status === 404) return setError(`${parsed.unit} is not in INEC's register. Check the code on your voter's card.`);
            setUnit(parsed.unit);
            setStep('camera');
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">What are you reporting?</legend>
            {TYPES.map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 has-[:checked]:border-brand has-[:checked]:bg-surface-tint">
                <input type="radio" name="type" value={value} checked={type === value} onChange={() => setType(value)} className="size-4" />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <label htmlFor="unit" className="font-semibold">Polling unit code</label>
            <input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} required inputMode="numeric" autoComplete="off" placeholder="24-05-01-003" className={`${field} tabular`} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="claim" className="font-semibold">What happened?</label>
            <p id="claim-hint" className="text-sm text-ink-muted">One or two sentences. Say what you saw, not who you think is responsible. Do not name private people.</p>
            <textarea id="claim" value={claim} onChange={(e) => setClaim(e.target.value)} required minLength={10} maxLength={280} rows={3} aria-describedby="claim-hint" className={`${field} py-2`} />
            <p className="text-right text-sm text-ink-muted tabular">{claim.length}/280</p>
          </div>
          {error && <p role="alert" className="text-mismatch">{error}</p>}
          <button type="submit" className="min-h-12 rounded-xl bg-brand px-6 font-semibold text-brand-ink hover:bg-brand-strong">Next: take the photo</button>
        </form>
      )}

      {step === 'camera' && (
        <section className={card} aria-label="Camera">
          <Camera
            onCapture={(blob) => {
              setPhoto({ blob, url: URL.createObjectURL(blob), capturedAt: new Date().toISOString() });
              setStep('review');
            }}
          />
        </section>
      )}

      {(step === 'review' || step === 'sending') && photo && (
        <section className={`${card} grid gap-4`} aria-labelledby="review-heading">
          <h2 id="review-heading" className="text-lg font-semibold">Check and send</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the live photo */}
          <img src={photo.url} alt="Your photo" className="max-h-80 w-full rounded-xl object-contain" />
          <dl className="grid gap-1 text-sm">
            <dt className="text-ink-muted">Report</dt>
            <dd>{TYPES.find(([v]) => v === type)?.[1]} at <span className="font-mono">{unit}</span></dd>
            <dt className="text-ink-muted">What happened</dt>
            <dd>{claim}</dd>
          </dl>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!coords}
              onChange={(e) => {
                if (!e.target.checked) return setCoords(null);
                navigator.geolocation?.getCurrentPosition(
                  (p) => setCoords({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
                  () => setError('Location is not available. You can send the report without it.'),
                  { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
                );
              }}
              className="size-4"
            />
            Add my location (makes the report stronger; never published)
          </label>
          {error && <p role="alert" className="text-mismatch">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={step === 'sending'} onClick={() => void send()} className="min-h-12 grow rounded-xl bg-brand px-6 font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-70">
              {step === 'sending' ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" disabled={step === 'sending'} onClick={() => setStep('camera')} className="min-h-12 rounded-xl border border-border px-5 font-semibold hover:bg-surface-muted">
              Retake
            </button>
          </div>
        </section>
      )}

      {step === 'done' && receipt && (
        <section className={`${card} grid gap-3`} aria-labelledby="done-heading">
          {receipt.emergency && <Emergency />}
          <h2 id="done-heading" className="text-lg font-semibold">Report received</h2>
          <p>
            Your report number is <strong className="font-mono text-lg">{receipt.reference}</strong>. Keep it to follow how your report is labelled.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/incidents?ref=${receipt.reference}`} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong">
              Follow this report
            </Link>
            <Link href="/capture" className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 font-semibold hover:bg-surface-muted">
              Photograph a result instead
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
