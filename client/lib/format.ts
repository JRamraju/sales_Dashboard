// client/lib/format.ts
//
// Single source of truth for number / currency / axis-tick formatting.
// Amounts are displayed as-is in Indian rupees (₹): there is NO currency conversion.
//
// To switch digit grouping (e.g. ₹22,566,778 instead of ₹2,25,66,778),
// change CURRENCY_LOCALE to 'en-US'. The ₹ symbol stays.

export const CURRENCY_LOCALE = 'en-IN';
export const CURRENCY_CODE = 'INR';
export const CURRENCY_SYMBOL = '₹';

const currencyFormatters = new Map<number, Intl.NumberFormat>();

const toSafeNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Full currency string, e.g. formatINR(2256677.8) -> "₹22,56,677.80".
 * Defaults to 2 fraction digits; pass { maximumFractionDigits: 0 } for whole rupees.
 */
export const formatINR = (
  value: unknown,
  options: { maximumFractionDigits?: number } = {}
): string => {
  const maximumFractionDigits = options.maximumFractionDigits ?? 2;
  let formatter = currencyFormatters.get(maximumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
      style: 'currency',
      currency: CURRENCY_CODE,
      minimumFractionDigits: Math.min(2, maximumFractionDigits),
      maximumFractionDigits,
    });
    currencyFormatters.set(maximumFractionDigits, formatter);
  }
  return formatter.format(toSafeNumber(value));
};

const COMPACT_UNITS: ReadonlyArray<{ size: number; suffix: string }> = [
  { size: 1e7, suffix: 'Cr' }, // crore
  { size: 1e5, suffix: 'L' }, // lakh
  { size: 1e3, suffix: 'K' }, // thousand
];

const trimOneDecimal = (n: number): string => n.toFixed(1).replace(/\.0$/, '');

/**
 * Compact currency for chart axes: ₹950, ₹12.5K, ₹3.4L, ₹1.2Cr.
 */
export const formatCompactINR = (value: unknown): string => {
  const n = toSafeNumber(value);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  for (let i = 0; i < COMPACT_UNITS.length; i += 1) {
    const { size } = COMPACT_UNITS[i];
    if (abs < size) continue;

    let unitIndex = i;
    // 99.96L rounds to "100L" -> promote to the next unit up (1Cr).
    if (
      Math.round((abs / size) * 10) / 10 >= 100 &&
      unitIndex > 0
    ) {
      unitIndex -= 1;
    }
    const unit = COMPACT_UNITS[unitIndex];
    return `${sign}${CURRENCY_SYMBOL}${trimOneDecimal(abs / unit.size)}${unit.suffix}`;
  }

  return `${sign}${CURRENCY_SYMBOL}${Math.round(abs)}`;
};

/** Plain count formatting (orders, customers) with the same digit grouping. */
export const formatNumber = (value: unknown): string =>
  new Intl.NumberFormat(CURRENCY_LOCALE).format(toSafeNumber(value));

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Short axis label for the API's date buckets:
 *   'YYYY-MM-DD' (day / week start) -> "12 Mar"  (or "12 Mar 25" when year changes matter)
 *   'YYYY-MM'    (month)            -> "Mar 25"
 * Anything unparseable is returned unchanged.
 */
export const formatAxisDate = (raw: string): string => {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (dayMatch) {
    const month = SHORT_MONTHS[Number(dayMatch[2]) - 1];
    if (!month) return raw;
    return `${Number(dayMatch[3])} ${month}`;
  }
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(raw);
  if (monthMatch) {
    const month = SHORT_MONTHS[Number(monthMatch[2]) - 1];
    if (!month) return raw;
    return `${month} ${monthMatch[1].slice(2)}`;
  }
  return raw;
};
