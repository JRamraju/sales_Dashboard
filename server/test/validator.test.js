import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSalesRow } from '../src/validators/salesRow.schema.js';

const base = {
  orderId: 'ORD-1', orderDate: '2026-01-05', customerId: 'C1', productName: 'Pen',
  quantity: '2', unitPrice: '5.50',
};

test('a minimal row is accepted and defaults are applied', () => {
  const r = validateSalesRow(base);
  assert.equal(r.ok, true);
  assert.equal(r.data.totalRevenue, 11);
  assert.equal(r.data.category, 'Uncategorized');
  assert.equal(r.data.region, 'Unknown');
  assert.equal(r.data.customerName, 'C1');
  assert.equal(r.data.productId, 'Pen');
});

test('total is quantity x price minus discount when total_amount is missing', () => {
  assert.equal(validateSalesRow({ ...base, discount: '1.5' }).data.totalRevenue, 9.5);
});

test('unit price is derived from total_amount when missing', () => {
  const r = validateSalesRow({ ...base, unitPrice: null, totalAmount: '20', discount: '0' });
  assert.equal(r.data.unitPrice, 10);
});

test('currency symbols and thousands separators are stripped', () => {
  assert.equal(validateSalesRow({ ...base, unitPrice: '₹1,299.50' }).data.unitPrice, 1299.5);
});

test('rejections explain what is wrong and name the column', () => {
  let r = validateSalesRow({ ...base, quantity: '-5', totalAmount: '-10' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Negative quantity/);
  assert.equal(r.field, 'quantity, total_amount');

  r = validateSalesRow({ ...base, orderDate: 'N/A' });
  assert.equal(r.field, 'order_date');
  assert.match(r.reason, /Invalid order_date format 'N\/A' \(expected DD\/MM\/YYYY or YYYY-MM-DD\)/);

  r = validateSalesRow({ ...base, unitPrice: null });
  assert.equal(r.field, 'unit_price');
  r = validateSalesRow({ ...base, productName: null });
  assert.equal(r.field, 'product_id');
  r = validateSalesRow({ ...base, discount: '50' }); // 11 - 50 < 0
  assert.equal(r.field, 'discount');
});

test('the date order option changes how a/b/YYYY is read', () => {
  const row = { ...base, orderDate: '03/04/2026' };
  assert.equal(validateSalesRow(row, { dateOrder: 'dmy' }).data.orderDate.toISOString(), '2026-04-03T00:00:00.000Z');
  assert.equal(validateSalesRow(row, { dateOrder: 'mdy' }).data.orderDate.toISOString(), '2026-03-04T00:00:00.000Z');
  assert.match(validateSalesRow({ ...row, orderDate: '26/05/2026' }, { dateOrder: 'mdy' }).reason, /MM\/DD\/YYYY/);
});

test('fractional or zero quantity is rejected', () => {
  assert.equal(validateSalesRow({ ...base, quantity: '1.5' }).ok, false);
  assert.equal(validateSalesRow({ ...base, quantity: '0' }).ok, false);
});
