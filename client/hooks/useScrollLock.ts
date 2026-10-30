// client/hooks/useScrollLock.ts
'use client';

import { useEffect } from 'react';
import { lockScroll } from '@/lib/smoothScroll';

/** Freezes page scrolling (native + Lenis) while `active` is true. */
export const useScrollLock = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    return lockScroll();
  }, [active]);
};
