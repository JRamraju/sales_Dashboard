// client/components/layout/SmoothScroll.tsx
'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import { setLenis } from '@/lib/smoothScroll';

/**
 * Site-wide smooth scrolling (Lenis). Mount once in the root layout.
 *
 *  - Respects `prefers-reduced-motion` (Lenis falls back to native 1:1 scroll).
 *  - Touch devices keep their native momentum scrolling.
 *  - Nested scrollers (tables, dropdown lists, modal bodies) scroll natively:
 *    Lenis detects them, and the known ones are also tagged `data-lenis-prevent`.
 *  - Page locks (drawer, popups) go through `lockScroll()` in lib/smoothScroll.
 */
export const SmoothScroll: React.FC = () => {
  useEffect(() => {
    const lenis = new Lenis({
      autoRaf: true,
      allowNestedScroll: true,
    });
    setLenis(lenis);

    return () => {
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return null;
};
