// client/hooks/useCountUp.ts
'use client';

import { useEffect, useRef, useState } from 'react';

interface CountUpOptions {
  /** Animation length in ms. */
  duration?: number;
  /** Wait this long (ms) before starting, e.g. to sync with a card's entrance. */
  delay?: number;
}

/** Ease-out quartic: fast start, long gentle slow-down into the final value. */
const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

/**
 * Counts from the currently shown value (0 on first mount) up to `target`,
 * decelerating towards the end. Returns the live number to render.
 * With `prefers-reduced-motion` the target is shown immediately.
 */
export const useCountUp = (
  target: number,
  { duration = 1800, delay = 0 }: CountUpOptions = {}
): number => {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState<number>(0);
  const shownRef = useRef<number>(0);

  // `delay` only matters when a run starts. Keeping it out of the effect's
  // dependencies stops a changing delay from restarting a run that is in flight.
  const delayRef = useRef<number>(delay);
  useEffect(() => {
    delayRef.current = delay;
  });

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const from = shownRef.current;

    let frame = 0;
    let timer = 0;

    const publish = (next: number) => {
      shownRef.current = next;
      setValue(next);
    };

    if (reduceMotion || from === safeTarget) {
      frame = window.requestAnimationFrame(() => publish(safeTarget));
      return () => window.cancelAnimationFrame(frame);
    }

    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / duration);
      publish(
        progress >= 1
          ? safeTarget
          : from + (safeTarget - from) * easeOutQuart(progress)
      );
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };

    timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(tick);
    }, delayRef.current);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [safeTarget, duration]);

  return value;
};
