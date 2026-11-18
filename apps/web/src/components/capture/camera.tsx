'use client';

import { useEffect, useRef, useState } from 'react';

/** Longest side of the saved photo: sharp enough to read figures, small enough for slow networks */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

type CameraState = 'starting' | 'live' | 'denied' | 'unavailable' | 'insecure';

/**
 * Live camera only (CAP-01): uses the phone's camera stream, with no gallery or file upload.
 */
export function Camera({ onCapture }: { onCapture: (photo: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setState(window.isSecureContext ? 'unavailable' : 'insecure');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        }
        setState('live');
      } catch (err) {
        const name = (err as DOMException).name;
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    setBusy(false);
    if (blob) onCapture(blob);
  }

  if (state === 'denied') {
    return (
      <Notice title="Camera access is blocked">
        Allow TrustElect to use your camera in your browser&apos;s site settings, then reload this page. Photos must be
        taken live, so uploads from your gallery are not possible.
      </Notice>
    );
  }
  if (state === 'unavailable') {
    return <Notice title="No camera found">This device has no camera TrustElect can use. Try another phone.</Notice>;
  }
  if (state === 'insecure') {
    return <Notice title="Secure connection needed">Open TrustElect over https to use the camera.</Notice>;
  }

  return (
    <div className="grid gap-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted autoPlay className="aspect-[3/4] w-full object-cover" aria-label="Camera preview" />
        {/* Framing guide for the poster */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-[6%] rounded-xl border-2 border-dashed border-white/80" />
        {state === 'starting' && (
          <p role="status" className="absolute inset-0 grid place-items-center text-white">
            Starting camera…
          </p>
        )}
      </div>
      <p className="text-sm text-ink-muted">
        Fit the whole poster inside the frame. Make sure the stamp and every figure are sharp and readable.
      </p>
      <button
        type="button"
        onClick={capture}
        disabled={state !== 'live' || busy}
        className="inline-flex min-h-14 items-center justify-center rounded-xl bg-brand px-5 text-lg font-semibold text-brand-ink hover:bg-brand-strong disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Take photo'}
      </button>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl border border-dispute bg-dispute-bg p-4 text-dispute">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{children}</p>
    </div>
  );
}
