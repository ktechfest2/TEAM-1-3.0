'use client';

import { useEffect, useRef, useState } from 'react';
import { preload } from 'react-dom';

/**
 * Full-screen hero film. Muted (the file has no sound track at all), looping; it pauses for anyone who prefers reduced
 * motion, and a button lets everyone pause it (moving content longer than 5 seconds).
 * The poster is the film's closing frame and the hero's main image, so it loads first.
 */
export function HeroVideo() {
  // The poster is the hero's largest image: request it early, at high priority
  preload('/media/hero-poster.jpg', { as: 'image', fetchPriority: 'high' });
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // React does not keep `muted` in server-rendered HTML; browsers only autoplay muted video
    v.muted = true;
    v.defaultMuted = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!reduce.matches) v.play().catch(() => undefined);
    const onChange = () => (reduce.matches ? v.pause() : undefined);
    reduce.addEventListener('change', onChange);
    return () => reduce.removeEventListener('change', onChange);
  }, []);

  return (
    <>
      <figure className="absolute inset-0 -z-20 m-0">
        <video
          ref={video}
          className="size-full object-cover portrait:max-sm:h-auto portrait:max-sm:object-contain"
          poster="/media/hero-poster.jpg"
          muted
          loop
          playsInline
          preload="metadata"
          aria-describedby="hero-video-caption"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          <source src="/media/hero.mp4" type="video/mp4" />
        </video>
        <figcaption id="hero-video-caption" className="sr-only">
          Animation: scattered result sheets become a bridge of verified evidence. Bridging the trust gap.
        </figcaption>
      </figure>
      <button
        type="button"
        onClick={() => {
          const v = video.current;
          if (!v) return;
          if (v.paused) void v.play().catch(() => undefined);
          else v.pause();
        }}
        aria-label={playing ? 'Pause the animation' : 'Play the animation'}
        className="absolute right-4 bottom-4 z-10 inline-flex size-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
          {playing ? <path d="M4 2h3v12H4zM9 2h3v12H9z" /> : <path d="M4 2.5v11l9-5.5z" />}
        </svg>
      </button>
    </>
  );
}
