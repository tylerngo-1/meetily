'use client';

import { useEffect, useRef, useState } from 'react';

const TICK_MS = 250;

/**
 * Smooth elapsed time from the backend's active duration, which RecordingStateContext
 * polls every 500ms. Interpolates between polls, freezes while paused, never goes backwards.
 */
export function useElapsedSeconds(activeDuration: number | null, isRecording: boolean, isPaused: boolean): number {
  const baseRef = useRef({ seconds: 0, at: 0 });
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (activeDuration == null) return;
    baseRef.current = { seconds: activeDuration, at: performance.now() };
    setElapsed(prev => Math.max(prev, activeDuration));
  }, [activeDuration]);

  useEffect(() => {
    if (!isRecording) {
      baseRef.current = { seconds: 0, at: 0 };
      setElapsed(0);
      return;
    }
    if (isPaused) return;

    // Re-anchor on (re)start so a resume doesn't count the paused time.
    baseRef.current = { ...baseRef.current, at: performance.now() };
    const id = setInterval(() => {
      const { seconds, at } = baseRef.current;
      const next = seconds + (performance.now() - at) / 1000;
      setElapsed(prev => Math.max(prev, next));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [isRecording, isPaused]);

  return elapsed;
}
