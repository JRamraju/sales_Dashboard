// client/components/kpi/AnimatedNumber.tsx
'use client';

import React from 'react';
import { useCountUp } from '@/hooks/useCountUp';

interface AnimatedNumberProps {
  /** Final value to count up to. */
  value: number;
  /** Turns the in-flight number into display text (rounding is up to the formatter). */
  format: (current: number) => string;
  duration?: number;
  delay?: number;
}

/**
 * A number that counts up and decelerates into `value`.
 * Screen readers get the final text once; the ticking digits are aria-hidden.
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  format,
  duration,
  delay,
}) => {
  const current = useCountUp(value, { duration, delay });
  const done = current === value;

  return (
    <>
      <span aria-hidden="true" data-count-done={done} className="tabular-nums">
        {format(current)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
};
