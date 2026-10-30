// client/hooks/usePresence.ts
'use client';

import { useEffect, useRef, useState } from 'react';

interface PresenceOptions {
  /** How long the exit animation runs (must match the CSS). */
  exitMs?: number;
  /** Called once the element has finished animating out and been unmounted. */
  onExited?: () => void;
}

interface PresenceResult {
  /** Render the popup while this is true (it outlives `open` during the exit animation). */
  mounted: boolean;
  /** Drive the CSS: put it on the popup as `data-state`. */
  state: 'open' | 'closed';
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Keeps a popup mounted long enough for its exit animation to play.
 *
 *   const { mounted, state } = usePresence(isOpen);
 *   if (!mounted) return null;
 *   return <div className="popup-panel" data-state={state}>…</div>;
 *
 * The enter animation is simply the CSS animation that runs when the element
 * mounts with `data-state="open"`; the exit animation runs for `exitMs` while
 * `data-state="closed"`, then the element is unmounted.
 */
export const usePresence = (
  open: boolean,
  { exitMs = 360, onExited }: PresenceOptions = {}
): PresenceResult => {
  const [mounted, setMounted] = useState<boolean>(open);

  // Opening: mount in the same render pass (no flash of nothing).
  if (open && !mounted) setMounted(true);

  const onExitedRef = useRef(onExited);
  useEffect(() => {
    onExitedRef.current = onExited;
  });

  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(
      () => {
        setMounted(false);
        onExitedRef.current?.();
      },
      prefersReducedMotion() ? 0 : exitMs
    );
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted, state: open ? 'open' : 'closed' };
};
