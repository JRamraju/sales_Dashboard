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

/**
 * Indian Rupee formatter (en-IN grouping, e.g. ₹12,34,567).
 * Accepts Intl options so callers can set `maximumFractionDigits`.
 * Takes `unknown` so it can be used directly as a Recharts formatter.
 */
export const formatINR = (
  value: unknown,
  options: Intl.NumberFormatOptions = {}
): string => {
  const num = Number(Array.isArray(value) ? value[0] : value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Math.abs(safe) >= 1000 ? 0 : 2,
    ...options,
  }).format(safe);
};

/** Compact rupees for chart axes (₹1.2L, ₹3.4Cr). */
export const formatCompactINR = (value: unknown): string => {
  const num = Number(Array.isArray(value) ? value[0] : value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(safe);
};

/** 'YYYY-MM' or 'YYYY-MM-DD' -> 'Jan 26' / '5 Jan' style axis label. */
export const formatAxisDate = (value: unknown): string => {
  const raw = String(value ?? '');
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw);
  if (!match) return raw;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d ?? 1)));
  if (Number.isNaN(date.getTime())) return raw;
  return d
    ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

export default formatCurrency;