import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDateOrder } from '../src/utils/dateOrder.util.js';
import { parseOrderDate } from '../src/validators/salesRow.schema.js';

test('a month above 12 proves month-first (US) dates', () => {
  const info = detectDateOrder(['5/26/2025', '1/2/2025', '3/4/2025'], 'dmy');
  assert.equal(info.order, 'mdy');
  assert.equal(info.detected, true);
  assert.equal(info.mdy, 1);
});

test('a day above 12 proves day-first dates', () => {
  assert.equal(detectDateOrder(['26/05/2025', '01/02/2025'], 'mdy').order, 'dmy');
});

test('without evidence the fallback decides and nothing is "detected"', () => {
  const info = detectDateOrder(['01/02/2025', '03/04/2025', '2025-01-05'], 'mdy');
  assert.deepEqual([info.order, info.detected, info.ambiguous], ['mdy', false, 2]);
});

test('mixed evidence goes to the majority', () => {
  assert.equal(detectDateOrder(['26/05/2025', '27/05/2025', '5/26/2025'], 'dmy').order, 'dmy');
});

test('non-string cells are ignored', () => {
  assert.equal(detectDateOrder([new Date(), 45000, null, undefined], 'dmy').detected, false);
});

test('parseOrderDate reads a/b/YYYY according to the order', () => {
  assert.equal(parseOrderDate('03/04/2026', 'dmy').toISOString(), '2026-04-03T00:00:00.000Z');
  assert.equal(parseOrderDate('03/04/2026', 'mdy').toISOString(), '2026-03-04T00:00:00.000Z');
  assert.equal(parseOrderDate('5/26/2025', 'mdy').toISOString(), '2025-05-26T00:00:00.000Z');
});

test('parseOrderDate rejects dates that do not exist', () => {
  assert.equal(parseOrderDate('31/02/2025', 'dmy'), null);
  assert.equal(parseOrderDate('2025-02-30'), null);
  assert.equal(parseOrderDate('2026-99-12'), null);
  assert.equal(parseOrderDate('26/05/2025', 'mdy'), null); // month 26
  assert.equal(parseOrderDate('N/A'), null);
});

test('parseOrderDate accepts ISO, datetimes, Date objects and Excel serials', () => {
  assert.equal(parseOrderDate('2026-03-15').toISOString(), '2026-03-15T00:00:00.000Z');
  assert.equal(parseOrderDate('2026-03-15T10:30:00Z').toISOString(), '2026-03-15T10:30:00.000Z');
  assert.equal(parseOrderDate(new Date('2026-03-15T00:00:00Z')).toISOString(), '2026-03-15T00:00:00.000Z');
  assert.equal(parseOrderDate(46000).toISOString(), '2025-12-09T00:00:00.000Z'); // Excel serial
  assert.equal(parseOrderDate(12), null); // not a plausible serial
  assert.equal(parseOrderDate('1850-01-01'), null); // outside 1900-2100
});
