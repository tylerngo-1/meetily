'use client';

import type { CSSProperties } from 'react';

const BAR_COUNT = 20;
const PAUSED_SCALE = 0.17; // 24px bar → 4px dot

// Fixed per-bar values so the bars move out of step without Math.random or re-renders.
function pseudoRandom(i: number): number {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const r = pseudoRandom(i);
  return {
    peak: 0.45 + 0.55 * r,
    duration: 0.8 + 0.6 * pseudoRandom(i + BAR_COUNT),
    delay: -r,
  };
});

/**
 * Decorative recording waveform. The bars are animated in CSS and do not reflect real
 * audio levels. Paused: the bars stop and shrink to dots.
 */
export function FakeWaveform({ isPaused }: { isPaused: boolean }) {
  return (
    <div className="flex h-6 items-center gap-[3px]" aria-hidden="true">
      {BARS.map((bar, i) => (
        <span
          key={i}
          className={`h-6 w-[3px] rounded-full transition-colors ${isPaused ? 'bg-gray-300' : 'bg-gray-400 motion-safe:animate-wave'}`}
          style={{
            '--wave-peak': bar.peak,
            transform: `scaleY(${isPaused ? PAUSED_SCALE : bar.peak * 0.6})`,
            animationDuration: `${bar.duration}s`,
            animationDelay: `${bar.delay}s`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
