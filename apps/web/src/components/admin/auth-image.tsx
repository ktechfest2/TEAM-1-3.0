'use client';

import { useEffect, useState } from 'react';
import { apiBlobUrl } from '@/lib/api';

/** An evidence image that needs the admin session: loaded with the token, shown from memory. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    apiBlobUrl(path, 'admin').then(
      (u) => {
        objectUrl = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) return <div className={`grid place-items-center text-xs text-ink-muted ${className ?? ''}`}>Could not load</div>;
  if (!url) return <div aria-busy="true" className={`animate-pulse bg-surface-muted ${className ?? ''}`} />;
  return (
    <a href={url} target="_blank" rel="noopener">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated evidence image */}
      <img src={url} alt={alt} className={className} />
    </a>
  );
}
