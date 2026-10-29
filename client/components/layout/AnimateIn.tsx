// client/components/layout/AnimateIn.tsx
'use client';

import React from 'react';

export type EnterDirection = 'left' | 'right';

/**
 * Entrance animation helpers (CSS lives in app/globals.css).
 *
 * The animation is CSS-only, plays once when the element mounts, and ends on
 * `transform: none`, so it never leaves a transform behind that would break
 * `position: fixed` / `sticky` descendants.
 */
export const enterClass = (direction: EnterDirection): string =>
  direction === 'left' ? 'enter-from-left' : 'enter-from-right';

export const enterDelay = (delayMs: number): React.CSSProperties =>
  ({ '--enter-delay': `${delayMs}ms` }) as React.CSSProperties;

interface AnimateInProps {
  direction: EnterDirection;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wrapper for normal in-flow content (cards, charts, tables).
 * Do NOT wrap the sticky TopFilterBar or the fixed Sidebar in this: apply
 * `enterClass()` directly on their own element instead.
 */
export const AnimateIn: React.FC<AnimateInProps> = ({
  direction,
  delay = 0,
  className = '',
  children,
}) => (
  <div
    className={`${enterClass(direction)} ${className}`.trim()}
    style={enterDelay(delay)}
  >
    {children}
  </div>
);
