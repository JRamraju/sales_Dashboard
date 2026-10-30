// client/lib/smoothScroll.ts
//
// Tiny bridge between the Lenis instance (created once by <SmoothScroll />)
// and everything else that needs to scroll or freeze the page: the sidebar
// scroll-spy, the mobile drawer, modals and SweetAlert2 dialogs.
//
// Lenis owns wheel scrolling. Anything that locks the page therefore has to
// stop Lenis too, otherwise the page keeps scrolling behind an open popup.

import type Lenis from 'lenis';

let instance: Lenis | null = null;

export const setLenis = (lenis: Lenis | null): void => {
  instance = lenis;
};

/** The active Lenis instance, or null (SSR, before mount, or if it failed to start). */
export const getLenis = (): Lenis | null => instance;

let lockCount = 0;
let restoreScroll: (() => void) | null = null;

/**
 * Freezes page scrolling (reference counted, so a modal opened from the
 * drawer, or a SweetAlert shown over a modal, unlocks only when the LAST
 * lock is released). Returns an idempotent release function.
 *
 * The scrollbar width is compensated so the layout does not jump sideways.
 */
export const lockScroll = (): (() => void) => {
  if (typeof document === 'undefined') return () => {};

  if (lockCount === 0) {
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    instance?.stop();

    restoreScroll = () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      instance?.start();
    };
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      restoreScroll?.();
      restoreScroll = null;
    }
  };
};
