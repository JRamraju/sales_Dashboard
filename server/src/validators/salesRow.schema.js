import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { CANONICAL_FIELDS } from '../utils/headerMapper.util.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

/* -------------------------------------------------------------------------- */
/* Sanitizing helpers                                                         */
/* -------------------------------------------------------------------------- */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Day-first on purpose: "03/04/2026" is read as 3 April 2026 (DD/MM/YYYY).
const DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD/MM/YYYY',
  'D/M/YYYY',
  'DD-MM-YYYY',
  'D-M-YYYY',
  'DD.MM.YYYY',
];
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Trims strings and turns blanks into null so the schema only has to reason
 * about "present" or "missing". Every canonical key is always present on the
 * result, which keeps the Zod object parse predictable.
 */
export function sanitizeRow(raw = {}) {
  const clean = {};
  for (const key of CANONICAL_FIELDS) {
    const value = raw[key];
    clean[key] = typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value ?? null;
  }
  return clean;
}

/**
 * Parses a money / quantity cell. Strips $ ₹ € £, thousands separators and
 * spaces from strings ("₹1,299.50" -> 1299.5). Returns NaN when unparseable.
 */
function parseNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'boolean') return NaN;
  const stripped = String(value).replace(/[$₹€£,\s]/g, '');
  if (stripped === '') return NaN;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Normalises many date representations to a UTC Date:
 * Date objects (Excel date cells), Excel serial numbers, ISO strings,
 * YYYY-MM-DD and DD/MM/YYYY style strings. Returns null when unparseable.
 */
export function parseOrderDate(value) {
  let parsed;

  if (value instanceof Date) {
    parsed = dayjs.utc(value);
  } else if (typeof value === 'number') {
    // Excel stores dates as days since 1899-12-30; accept a sane serial range.
    if (value < 20000 || value > 80000) return null;
    parsed = dayjs.utc('1899-12-30').add(Math.floor(value), 'day');
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (ISO_DATETIME.test(text)) {
      parsed = dayjs.utc(text);
    } else {
      // Try each format on its own in strict mode. (dayjs ignores UTC mode when
      // given an array of formats, which shifts dates by the server's offset.)
      parsed = DATE_FORMATS.map((format) => dayjs.utc(text, format, true)).find((d) => d.isValid());
      if (!parsed) return null;
    }
  } else {
    return null;
  }

  if (!parsed.isValid()) return null;
  const year = parsed.year();
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return parsed.toDate();
}

/* -------------------------------------------------------------------------- */
/* Field schemas                                                              */
/* -------------------------------------------------------------------------- */

// A raw cell can be text, a number, a boolean or a Date (Excel), or empty.
const cell = z.union([z.string(), z.number(), z.boolean(), z.date()]).nullable();

/**
 * Builds a field schema from a function that returns `{ value }` or
 * `{ error }`. Errors become Zod issues, so every problem in a row is
 * collected and reported together.
 */
const field = (fn) =>
  cell.transform((value, ctx) => {
    const result = fn(isBlank(value) ? undefined : value);
    if (result && result.error) {
      ctx.addIssue({ code: 'custom', message: result.error });
      return z.NEVER;
    }
    return result ? result.value : undefined;
  });

const text = (label, { required = false } = {}) =>
  field((v) => {
    if (v === undefined) return required ? { error: `Missing ${label}` } : { value: undefined };
    return { value: String(v).trim() };
  });

const numeric = (label, check, { required = false } = {}) =>
  field((v) => {
    if (v === undefined) return required ? { error: `Missing ${label}` } : { value: undefined };
    const n = parseNumeric(v);
    if (Number.isNaN(n)) return { error: `Invalid ${label} '${v}'` };
    const error = check ? check(n) : null;
    return error ? { error } : { value: n };
  });

const orderDateField = field((v) => {
  if (v === undefined) return { error: 'Missing order_date' };
  const date = parseOrderDate(v);
  return date ? { value: date } : { error: `Invalid order_date format '${v instanceof Date ? 'invalid date' : v}'` };
});

const quantityField = numeric(
  'quantity',
  (n) => {
    if (n < 0) return `Negative quantity (${n}) not allowed`;
    if (n === 0) return 'Quantity must be greater than 0';
    if (!Number.isInteger(n)) return `Quantity (${n}) must be a whole number`;
    return null;
  },
  { required: true }
);

const nonNegative = (label) => (n) => (n < 0 ? `Negative ${label} (${n}) not allowed` : null);

/* -------------------------------------------------------------------------- */
/* Row schema                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Validates one sanitized row and coerces it into the SalesRecord shape.
 *
 * Hard rejects (row is quarantined): unparseable/missing order_date,
 * quantity <= 0, both unit_price and total_amount missing, plus missing
 * order_id / customer_id / product and negative money values.
 *
 * Auto-recoverable: missing total_amount is computed as
 * (quantity * unit_price) - discount; blank category -> "Uncategorized";
 * blank region -> "Unknown"; blank discount -> 0.
 */
export const salesRowSchema = z
  .object({
    orderId: text('order_id', { required: true }),
    orderDate: orderDateField,
    customerId: text('customer_id', { required: true }),
    customerName: text('customer_name'),
    productId: text('product_id'),
    productName: text('product_name'),
    category: text('category'),
    region: text('region'),
    quantity: quantityField,
    unitPrice: numeric('unit_price', nonNegative('unit_price')),
    discount: numeric('discount', nonNegative('discount')),
    totalAmount: numeric('total_amount', nonNegative('total_amount')),
  })
  .transform((row, ctx) => {
    const fail = (message) => {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    };

    if (!row.productId && !row.productName) return fail('Missing product_id and product_name');
    if (row.unitPrice === undefined && row.totalAmount === undefined) {
      return fail('Both unit_price and total_amount are missing');
    }

    const discount = row.discount ?? 0;
    const totalRevenue =
      row.totalAmount !== undefined
        ? round2(row.totalAmount)
        : round2(row.quantity * row.unitPrice - discount);

    if (totalRevenue < 0) return fail(`Discount (${discount}) exceeds the line total`);

    const unitPrice =
      row.unitPrice !== undefined
        ? round2(row.unitPrice)
        : round2((row.totalAmount + discount) / row.quantity);

    return {
      orderId: row.orderId,
      orderDate: row.orderDate,
      customerId: row.customerId,
      customerName: row.customerName || row.customerId,
      productId: row.productId || row.productName,
      productName: row.productName || row.productId,
      category: row.category || 'Uncategorized',
      region: row.region || 'Unknown',
      quantity: row.quantity,
      unitPrice,
      discount: round2(discount),
      totalRevenue,
    };
  });

/**
 * Sanitizes + validates one raw row.
 * @returns {{ ok: true, data: object } | { ok: false, reason: string }}
 */
export function validateSalesRow(raw) {
  const result = salesRowSchema.safeParse(sanitizeRow(raw));
  if (result.success) return { ok: true, data: result.data };

  const reason = [...new Set(result.error.issues.map((issue) => issue.message))].join('; ');
  return { ok: false, reason };
}
