// client/components/layout/WelcomeSplash.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';

/** Splash stays at least this long so the welcome is actually readable. */
const MIN_VISIBLE_MS = 1800;
/** Hard cap so a slow or unreachable API can never trap the user on the splash. */
const MAX_VISIBLE_MS = 4000;
/** Must match the opacity transition on .welcome-splash in globals.css. */
const FADE_OUT_MS = 450;

interface IntroState {
  /** Splash element is still mounted (visible or fading out). */
  showSplash: boolean;
  /** Splash has started fading out: mount the dashboard so its entrance plays. */
  leaving: boolean;
}

/**
 * Controls the first-load welcome sequence:
 *   splash visible -> (data ready AND min time elapsed, or max time hit)
 *   -> dashboard mounts + splash fades out -> splash unmounts.
 *
 * `ready` should be true once the initial data load has settled. The sequence
 * runs once per full page load and never restarts.
 */
export const useWelcomeIntro = (ready: boolean): IntroState => {
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const minTimer = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const maxTimer = window.setTimeout(() => setMaxElapsed(true), MAX_VISIBLE_MS);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, []);

  const leaving = (ready && minElapsed) || maxElapsed;

  useEffect(() => {
    if (!leaving) return;
    const fadeTimer = window.setTimeout(() => setFinished(true), FADE_OUT_MS);
    return () => window.clearTimeout(fadeTimer);
  }, [leaving]);

  return { showSplash: !finished, leaving };
};

interface WelcomeSplashProps {
  leaving: boolean;
}

export const WelcomeSplash: React.FC<WelcomeSplashProps> = ({ leaving }) => (
  <div
    className="welcome-splash fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 px-6"
    data-leaving={leaving ? 'true' : 'false'}
    role="status"
    aria-live="polite"
    aria-label="Loading SalesPulse BI"
  >
    {/* Soft indigo glow behind the logo */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/20 blur-3xl"
    />

    <div className="relative flex max-w-sm flex-col items-center text-center">
      <div
        className="welcome-rise flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/40"
        style={{ '--rise-delay': '0ms' } as React.CSSProperties}
      >
        <BarChart3 className="h-8 w-8" />
      </div>

      <p
        className="welcome-rise mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300"
        style={{ '--rise-delay': '120ms' } as React.CSSProperties}
      >
        Welcome to
      </p>
      <h1
        className="welcome-rise mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl"
        style={{ '--rise-delay': '220ms' } as React.CSSProperties}
      >
        SalesPulse BI
      </h1>
      <p
        className="welcome-rise mt-2 text-sm text-slate-400"
        style={{ '--rise-delay': '320ms' } as React.CSSProperties}
      >
        ETL &amp; Forecasting Engine
      </p>

      <div
        className="welcome-rise mt-8 h-1 w-48 overflow-hidden rounded-full bg-slate-800"
        style={{ '--rise-delay': '420ms' } as React.CSSProperties}
        aria-hidden="true"
      >
        <div className="welcome-bar h-full w-1/3 rounded-full bg-indigo-500" />
      </div>
    </div>
  </div>
);
