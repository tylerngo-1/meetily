'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizableSplitOptions {
  /** localStorage key for the ratio; persistence is optional and failures are ignored. */
  storageKey: string;
  defaultRatio: number;
  minRatio: number;
  maxRatio: number;
  /** Accessible name of the separator, e.g. "Resize transcript and notes". */
  label: string;
  /** Used in aria-valuetext: "<firstPaneName> panel 60 percent". */
  firstPaneName: string;
}

/**
 * Two-pane horizontal split with a draggable, keyboard-accessible separator.
 * `ratio` is the first pane's share of the container width. Below 768 px `isDesktop` is false
 * and callers switch to a single-pane layout.
 */
export function useResizableSplit({
  storageKey,
  defaultRatio,
  minRatio,
  maxRatio,
  label,
  firstPaneName,
}: UseResizableSplitOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const [isDesktop, setIsDesktop] = useState(true);
  const dragging = useRef(false);

  const clamp = useCallback(
    (value: number) => Math.min(maxRatio, Math.max(minRatio, value)),
    [minRatio, maxRatio],
  );

  const store = useCallback((value: number) => {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      // Layout persistence is optional.
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const n = raw == null ? NaN : Number(raw);
      setRatio(Number.isFinite(n) && n >= minRatio && n <= maxRatio ? n : defaultRatio);
    } catch {
      setRatio(defaultRatio);
    }
  }, [storageKey, defaultRatio, minRatio, maxRatio]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const updateLayout = () => setIsDesktop(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setRatio(clamp((event.clientX - rect.left) / rect.width));
  }, [clamp]);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setRatio((current) => {
      store(current);
      return current;
    });
  }, [store]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const next =
      event.key === 'ArrowLeft' ? clamp(ratio - 0.05) :
      event.key === 'ArrowRight' ? clamp(ratio + 0.05) :
      event.key === 'Home' ? minRatio :
      event.key === 'End' ? maxRatio :
      null;
    if (next === null) return;
    event.preventDefault();
    setRatio(next);
    store(next);
  }, [ratio, clamp, minRatio, maxRatio, store]);

  return {
    containerRef,
    ratio,
    isDesktop,
    /** Spread on the element that contains both panes. */
    containerHandlers: { onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    /** Spread on the separator element. */
    separatorProps: {
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': Math.round(ratio * 100),
      'aria-valuemin': Math.round(minRatio * 100),
      'aria-valuemax': Math.round(maxRatio * 100),
      'aria-valuetext': `${firstPaneName} panel ${Math.round(ratio * 100)} percent`,
      'aria-label': label,
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
    },
  };
}
