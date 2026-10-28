import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { CANONICAL_FIELDS } from '../utils/headerMapper.util.js';
import { DATE_ORDER_LABELS, SLASH_DATE, defaultDateOrder } from '../utils/dateOrder.util.js';

dayjs.extend(utc);

/* -------------------------------------------------------------------------- */
/* Sanitizing helpers                                                         */
/* -------------------------------------------------------------------------- */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const YMD_DATE = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T].*)?$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Column names as shown to the user (snake_case, same as the sample files). */
export const FIELD_LABELS = {
  orderId: 'order_id',
  orderDate: 'order_date',
  customerId: 'customer_id',
  customerName: 'customer_name',
  productId: 'product_id',
  productName: 'product_name',
  category: 'category',
  region: 'region',
  quantity: 'quantity',
  unitPrice: 'unit_price',
  discount: 'discount',
  totalAmount: 'total_amount',
};

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

/** A real calendar date at UTC midnight, or null (rejects 31 Feb, year 0099, ...). */
function utcDate(year, month, day) {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date : null;
}

/**
 * Normalises many date representations to a UTC Date:
 * Date objects (Excel date cells), Excel serial numbers, ISO strings,
 * YYYY-MM-DD, and a/b/YYYY strings (day-first or month-first, see `order`).
 * Returns null when unparseable.
 *
 * Plain dates are parsed with regular expressions instead of dayjs: this runs
 * once per row, and trying seven dayjs strict formats per cell was the slowest
 * step of ingesting a large file.
 *
 * @param {unknown} value
 * @param {'dmy'|'mdy'} [order]  how to read an ambiguous a/b/YYYY date
 */
export function parseOrderDate(value, order = defaultDateOrder()) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    return year < MIN_YEAR || year > MAX_YEAR ? null : new Date(value.getTime());
  }

  if (typeof value === 'number') {
    // Excel stores dates as days since 1899-12-30; accept a sane serial range.
    if (value < 20000 || value > 80000) return null;
    const parsed = dayjs.utc('1899-12-30').add(Math.floor(value), 'day');
    return utcDate(parsed.year(), parsed.month() + 1, parsed.date());
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();

  if (ISO_DATETIME.test(text)) {
    const parsed = dayjs.utc(text);
    if (!parsed.isValid()) return null;
    const year = parsed.year();
    return year < MIN_YEAR || year > MAX_YEAR ? null : parsed.toDate();
  }

  let match = YMD_DATE.exec(text);
  if (match) return utcDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = SLASH_DATE.exec(text);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    return order === 'mdy' ? utcDate(year, first, second) : utcDate(year, second, first);
  }

  return null;
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
 * Builds the row schema for one date order. Two instances are created once at
 * start-up (day-first and month-first); the order is chosen per uploaded file.
 *
 * Hard rejects (row is quarantined): unparseable/missing order_date,
 * quantity <= 0, both unit_price and total_amount missing, plus missing
 * order_id / customer_id / product and negative money values.
 *
 * Auto-recoverable: missing total_amount is computed as
 * (quantity * unit_price) - discount; blank category -> "Uncategorized";
 * blank region -> "Unknown"; blank discount -> 0.
 */
function buildSalesRowSchema(order) {
  const dateHint = `${DATE_ORDER_LABELS[order]} or YYYY-MM-DD`;

  const orderDateField = field((v) => {
    if (v === undefined) return { error: 'Missing order_date' };
    const date = parseOrderDate(v, order);
    if (date) return { value: date };
    const shown = v instanceof Date ? 'invalid date' : v;
    return { error: `Invalid order_date format '${shown}' (expected ${dateHint})` };
  });

  return z
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
      const fail = (message, path) => {
        ctx.addIssue({ code: 'custom', message, path: [path] });
        return z.NEVER;
      };

      if (!row.productId && !row.productName) {
        return fail('Missing product_id and product_name', 'productId');
      }
      if (row.unitPrice === undefined && row.totalAmount === undefined) {
        return fail('Both unit_price and total_amount are missing', 'unitPrice');
      }

      const discount = row.discount ?? 0;
      const totalRevenue =
        row.totalAmount !== undefined
          ? round2(row.totalAmount)
          : round2(row.quantity * row.unitPrice - discount);

      if (totalRevenue < 0) return fail(`Discount (${discount}) exceeds the line total`, 'discount');

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
}

const SCHEMAS = { dmy: buildSalesRowSchema('dmy'), mdy: buildSalesRowSchema('mdy') };

/** Day-first schema (the historical default); prefer getSalesRowSchema(order). */
export const salesRowSchema = SCHEMAS.dmy;

export function getSalesRowSchema(order) {
  return SCHEMAS[order] ?? SCHEMAS[defaultDateOrder()];
}

/**
 * Sanitizes + validates one raw row.
 * @param {object} raw
 * @param {{ dateOrder?: 'dmy'|'mdy' }} [options]  how to read a/b/YYYY dates
 * @returns {{ ok: true, data: object } | { ok: false, reason: string, field: string }}
 */
export function validateSalesRow(raw, { dateOrder } = {}) {
  const result = getSalesRowSchema(dateOrder).safeParse(sanitizeRow(raw));
  if (result.success) return { ok: true, data: result.data };

  const issues = result.error.issues;
  const reason = [...new Set(issues.map((issue) => issue.message))].join('; ');
  const fields = [...new Set(issues.map((issue) => FIELD_LABELS[issue.path?.[0]] ?? 'row'))];
  return { ok: false, reason, field: fields.join(', ') };
}
