/**
 * Day-first vs month-first date detection.
 *
 * "03/04/2026" means 3 April in India/UK/EU files and 4 March in US files, and
 * nothing in the cell itself says which. Guessing one order for every upload
 * silently corrupts data for the other (a US-style file such as "5/26/2025"
 * is rejected, and "4/11/2025" is quietly read as 4 November).
 *
 * So the order is decided once per file from the evidence in that file: any
 * date whose first number is above 12 proves day-first ("26/05/2025"), any date
 * whose second number is above 12 proves month-first ("5/26/2025"). When the
 * file holds no such evidence the DEFAULT_DATE_ORDER env var decides
 * (default: day-first, as in the original implementation).
 */

export const DATE_ORDERS = ['dmy', 'mdy'];

export const DATE_ORDER_LABELS = { dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY' };

export function defaultDateOrder() {
  return String(process.env.DEFAULT_DATE_ORDER ?? '').toLowerCase() === 'mdy' ? 'mdy' : 'dmy';
}

/** a/b/yyyy, a-b-yyyy or a.b.yyyy, optionally followed by a time part. */
export const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/;

/**
 * @param {unknown[]} values  raw order_date cells (non-strings are ignored)
 * @param {'dmy'|'mdy'} [fallback]
 * @returns {{ order: 'dmy'|'mdy', detected: boolean, dmy: number, mdy: number, ambiguous: number }}
 */
export function detectDateOrder(values, fallback = defaultDateOrder()) {
  let dmy = 0;
  let mdy = 0;
  let ambiguous = 0;

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = SLASH_DATE.exec(value.trim());
    if (!match) continue;

    const first = Number(match[1]);
    const second = Number(match[2]);

    if (first > 12 && second <= 12) dmy += 1;
    else if (second > 12 && first <= 12) mdy += 1;
    else if (first <= 12 && second <= 12 && first !== second) ambiguous += 1;
  }

  if (dmy > mdy) return { order: 'dmy', detected: true, dmy, mdy, ambiguous };
  if (mdy > dmy) return { order: 'mdy', detected: true, dmy, mdy, ambiguous };
  return { order: fallback, detected: false, dmy, mdy, ambiguous };
}
