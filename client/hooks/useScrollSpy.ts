// client/hooks/useScrollSpy.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Sections whose tops are within this many px share one visual "band". */
const SAME_BAND_TOLERANCE_PX = 8;
/** Distance from the page bottom that counts as "scrolled to the end". */
const BOTTOM_TOLERANCE_PX = 8;
/** Breathing room between the sticky header and the activation line. */
const ACTIVATION_GAP_PX = 24;
/** Safety net: release the click-lock even if `scrollend` never fires. */
const CLICK_LOCK_FALLBACK_MS = 1000;
const FALLBACK_HEADER_PX = 112;

const getHeaderHeight = (): number => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    '--app-header-h'
  );
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : FALLBACK_HEADER_PX;
};

interface ScrollSpyResult {
  /** Id of the section currently highlighted in the navigation. */
  activeId: string;
  /** Highlight `id` immediately and smooth-scroll to it without flicker. */
  scrollToSection: (id: string) => void;
}

/**
 * Scroll-spy for the sidebar.
 *
 * `ids` must be in page order (top to bottom, left to right). Rules:
 *  - Active = last section whose top has crossed the activation line
 *    (sticky header height + a small gap); the first section by default.
 *  - At the very bottom of the page the last section is active, even if it
 *    is too short to ever reach the line.
 *  - Side-by-side sections (tops within a few px) form one band: if the
 *    active item is already in the band it stays, otherwise the first one
 *    in `ids` order wins.
 *  - After a click, spy updates are paused until the smooth scroll settles,
 *    so the highlight does not flicker through intermediate items.
 *  - Sections are looked up lazily on every update, because they only exist
 *    once the dashboard has mounted and data has loaded.
 */
export const useScrollSpy = (ids: readonly string[]): ScrollSpyResult => {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? '');

  const activeRef = useRef<string>(ids[0] ?? '');
  const lockedRef = useRef(false);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);

  const commit = useCallback((id: string) => {
    activeRef.current = id;
    setActiveId(id);
  }, []);

  const compute = useCallback(() => {
    frameRef.current = null;
    if (lockedRef.current) return;

    const sections = ids
      .map((id) => {
        const el = document.getElementById(id);
        return el ? { id, top: el.getBoundingClientRect().top } : null;
      })
      .filter((s): s is { id: string; top: number } => s !== null);

    if (sections.length === 0) return;

    const doc = document.documentElement;
    const isScrollable = doc.scrollHeight > window.innerHeight + 1;
    const atBottom =
      isScrollable &&
      window.innerHeight + window.scrollY >=
        doc.scrollHeight - BOTTOM_TOLERANCE_PX;

    if (atBottom) {
      const last = sections[sections.length - 1].id;
      if (last !== activeRef.current) commit(last);
      return;
    }

    const line = getHeaderHeight() + ACTIVATION_GAP_PX;
    let candidateIndex = 0;
    sections.forEach((section, index) => {
      if (section.top <= line) candidateIndex = index;
    });

    const candidateTop = sections[candidateIndex].top;
    const band = sections.filter(
      (s) => Math.abs(s.top - candidateTop) <= SAME_BAND_TOLERANCE_PX
    );

    const next = band.some((s) => s.id === activeRef.current)
      ? activeRef.current
      : band[0].id;

    if (next !== activeRef.current) commit(next);
  }, [ids, commit]);

  const requestCompute = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(compute);
    }
  }, [compute]);

  useEffect(() => {
    window.addEventListener('scroll', requestCompute, { passive: true });
    window.addEventListener('resize', requestCompute);

    // Layout shifts (data arriving, charts resizing) change section tops
    // without any scroll event.
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(requestCompute)
        : null;
    observer?.observe(document.body);

    requestCompute();

    return () => {
      window.removeEventListener('scroll', requestCompute);
      window.removeEventListener('resize', requestCompute);
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      releaseLockRef.current?.();
    };
  }, [requestCompute]);

  const scrollToSection = useCallback(
    (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;

      releaseLockRef.current?.();

      commit(id);
      lockedRef.current = true;

      const release = () => {
        lockedRef.current = false;
        releaseLockRef.current = null;
        window.clearTimeout(fallbackTimer);
        window.removeEventListener('scrollend', release);
        window.removeEventListener('wheel', release);
        window.removeEventListener('touchstart', release);
        window.removeEventListener('keydown', release);
        requestCompute();
      };
      releaseLockRef.current = release;

      // scrollend: scroll finished. wheel/touch/key: the user took over.
      window.addEventListener('scrollend', release, { once: true });
      window.addEventListener('wheel', release, { once: true, passive: true });
      window.addEventListener('touchstart', release, {
        once: true,
        passive: true,
      });
      window.addEventListener('keydown', release, { once: true });
      const fallbackTimer = window.setTimeout(release, CLICK_LOCK_FALLBACK_MS);

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [commit, requestCompute]
  );

  return { activeId, scrollToSection };
};
