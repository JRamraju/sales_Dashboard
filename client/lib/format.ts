// client/lib/format.ts

/**
 * Formats a numeric value as USD currency.
 * Values >= 1,000 omit decimals by default unless `forceDecimals` is set.
 */
export const formatCurrency = (
  value: number | null | undefined,
  forceDecimals = false
): string => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: forceDecimals ? 2 : 0,
    maximumFractionDigits: forceDecimals || Math.abs(num) < 1000 ? 2 : 0,
  }).format(num);
};

/**
 * Alias for shared money formatting convenience
 */
export const formatMoney = formatCurrency;

/**
 * Compact currency formatter (e.g., $1.2M, $45.3K) for chart axes
 */
export const formatCompactCurrency = (
  value: number | null | undefined
): string => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(num);
};

/**
 * Standard integer/decimal number formatter with thousands separators
 */
export const formatNumber = (value: number | null | undefined): string => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('en-US').format(num);
};

/**
 * Formats a percentage with optional sign and 1 decimal place
 */
export const formatPercent = (
  value: number | null | undefined,
  includeSign = false
): string => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0.0%';
  const prefix = includeSign && num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(1)}%`;
};

export default formatCurrency;
