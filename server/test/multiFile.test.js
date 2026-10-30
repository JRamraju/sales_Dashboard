import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildMatch, batchClause, optionsPipeline } from '../src/services/kpi.service.js';
import { resolveFiles } from '../src/controllers/analytics.controller.js';
import { newRowsByFile, shapeNewRecords } from '../src/services/newRecords.service.js';
import { createOrderDeduper, describeDuplicates } from '../src/services/duplicateOrders.service.js';
import { removeUnreferencedMasters } from '../src/services/masterData.service.js';
import { withFileNumbers, buildBatchSnapshot } from '../src/utils/uploadMappers.util.js';
import { TtlCache } from '../src/utils/cache.util.js';

const { ObjectId } = mongoose.Types;
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';

/* ------------------------------ multi-file match ------------------------------ */

test('one file matches by equality, exactly as before', () => {
  const m = buildMatch({ batchId: A });
  assert.ok(m.batchId instanceof ObjectId);
  assert.equal(String(m.batchId), A);
  assert.equal(String(buildMatch({ batchIds: [A] }).batchId), A);
});

test('several files match with $in, and the other filters still apply', () => {
  const m = buildMatch({ batchIds: [A, B], categories: ['X'] });
  assert.deepEqual(m.batchId.$in.map(String), [A, B]);
  assert.deepEqual(m.category, { $in: ['X'] });
});

test('no files at all matches nothing', () => {
  assert.deepEqual(batchClause([]), { $in: [] });
  assert.deepEqual(optionsPipeline([])[0].$match.batchId, { $in: [] });
});

/* ------------------------------ file selection ------------------------------ */

const fakeBatches = (rows) => ({
  find(query) {
    let hits = rows;
    if (query.status) hits = hits.filter((r) => r.status === query.status);
    if (query._id?.$in) hits = hits.filter((r) => query._id.$in.map(String).includes(String(r._id)));
    const chain = { select: () => chain, lean: async () => hits };
    return chain;
  },
});

const batches = fakeBatches([
  { _id: new ObjectId(B), status: 'completed' },
  { _id: new ObjectId(A), status: 'completed' },
  { _id: new ObjectId(C), status: 'processing' },
]);

test('with no selection, every finished file is used, in a stable order', async () => {
  const files = await resolveFiles({}, batches);
  assert.deepEqual(files.ids, [A, B]);
  assert.equal(files.allCompleted, true);
  assert.equal(files.key, `files=${A}+${B}`);
});

test('a selection (batchIds or the old batchId) picks exactly those files', async () => {
  assert.deepEqual((await resolveFiles({ batchIds: `${B},${A}` }, batches)).ids, [A, B]);
  assert.deepEqual((await resolveFiles({ batchId: A }, batches)).ids, [A]);
  assert.deepEqual((await resolveFiles({ batchIds: [A, A] }, batches)).ids, [A]);
});

test('a file still processing is selectable but its results are not cached', async () => {
  const files = await resolveFiles({ batchIds: `${A},${C}` }, batches);
  assert.equal(files.allCompleted, false);
});

test('bad or unknown file ids are rejected', async () => {
  await assert.rejects(resolveFiles({ batchIds: 'nope' }, batches), (e) => e.statusCode === 400);
  await assert.rejects(resolveFiles({ batchIds: 'dddddddddddddddddddddddd' }, batches), (e) => e.statusCode === 404);
});

test('deleting a file clears every cached result that includes it', () => {
  const cache = new TtlCache({ ttlMs: 60_000, maxEntries: 50 });
  cache.wrap(`files=${A}:x:1`, () => 1);
  cache.wrap(`files=${A}+${B}:x:2`, () => 2);
  cache.wrap(`files=${B}:x:3`, () => 3);
  return Promise.resolve().then(() => {
    cache.invalidateWhere((key) => key.includes(A));
    assert.equal(cache.size, 1);
  });
});

/* ------------------------------ new customers / products ------------------------------ */

const pair = (batchId, customerId, revenue = 10) => ({
  _id: { batchId: new ObjectId(batchId), customerId },
  customerName: `Name ${customerId}`,
  orders: 1,
  revenue,
  firstOrderDate: new Date('2026-01-01'),
});

test('new means not in ANY earlier file', () => {
  const rows = [pair(A, 'c1'), pair(A, 'c2'), pair(B, 'c2'), pair(B, 'c3'), pair(C, 'c1'), pair(C, 'c3'), pair(C, 'c4')];
  const result = newRowsByFile([A, B, C], rows, 'customerId');

  assert.deepEqual(result.get(A).map((r) => r._id.customerId), ['c1', 'c2']);
  assert.deepEqual(result.get(B).map((r) => r._id.customerId), ['c3']);
  assert.deepEqual(result.get(C).map((r) => r._id.customerId), ['c4']);
});

const orderedFiles = [
  { id: A, fileName: 'jan.xlsx', uploadedAt: new Date('2026-01-01'), fileNumber: 1 },
  { id: B, fileName: 'feb.xlsx', uploadedAt: new Date('2026-02-01'), fileNumber: 2 },
  { id: C, fileName: 'mar.xlsx', uploadedAt: new Date('2026-03-01'), fileNumber: 3 },
];

test('the first file reports nothing new, later files are compared with all earlier ones', () => {
  const customerRows = [pair(A, 'c1'), pair(B, 'c1'), pair(B, 'c2', 50), pair(B, 'c3', 70), pair(C, 'c3'), pair(C, 'c9', 5)];
  const out = shapeNewRecords({
    orderedFiles,
    selectedIds: [A, B, C],
    customerRows,
    productRows: [],
    limit: 100,
  });

  const [f1, f2, f3] = out.files;
  assert.equal(f1.isFirstFile, true);
  assert.equal(f1.newCustomers.count, 0);
  assert.deepEqual(f2.comparedWith.map((f) => f.fileNumber), [1]);
  assert.deepEqual(f2.newCustomers.items.map((i) => i.customerId), ['c3', 'c2']); // by revenue, highest first
  assert.equal(f2.newCustomers.revenue, 120);
  assert.deepEqual(f3.comparedWith.map((f) => f.fileNumber), [1, 2]);
  assert.deepEqual(f3.newCustomers.items.map((i) => i.customerId), ['c9']);
});

test('only the selected files are reported, but "earlier" still means every earlier file', () => {
  const customerRows = [pair(A, 'c1'), pair(B, 'c2'), pair(C, 'c1'), pair(C, 'c2'), pair(C, 'c3')];
  const out = shapeNewRecords({ orderedFiles, selectedIds: [C], customerRows, productRows: [], limit: 100 });

  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].fileNumber, 3);
  assert.deepEqual(out.files[0].newCustomers.items.map((i) => i.customerId), ['c3']);
});

test('the list is capped but count and revenue cover everything', () => {
  const customerRows = [pair(A, 'c0'), ...Array.from({ length: 5 }, (_, i) => pair(B, `n${i}`, i + 1))];
  const out = shapeNewRecords({ orderedFiles: orderedFiles.slice(0, 2), selectedIds: [B], customerRows, productRows: [], limit: 2 });

  const { newCustomers } = out.files[0];
  assert.equal(newCustomers.count, 5);
  assert.equal(newCustomers.revenue, 15);
  assert.equal(newCustomers.items.length, 2);
  assert.equal(newCustomers.truncated, true);
});

/* ------------------------------ duplicate orders ------------------------------ */

function fakeDedupeModels({ batches: batchRows, sales }) {
  return {
    UploadBatchModel: {
      find(query) {
        const hits = batchRows.filter(
          (b) => b.status === query.status && String(b._id) !== String(query._id.$ne)
        );
        const chain = { select: () => chain, lean: async () => hits };
        return chain;
      },
    },
    SalesRecordModel: {
      async aggregate([{ $match }]) {
        const ids = $match.orderId.$in;
        const batchIds = $match.batchId.$in.map(String);
        const seen = new Map();
        for (const row of sales) {
          if (ids.includes(row.orderId) && batchIds.includes(String(row.batchId)) && !seen.has(row.orderId)) {
            seen.set(row.orderId, { _id: row.orderId, batchId: row.batchId });
          }
        }
        return [...seen.values()];
      },
    },
  };
}

test('orders found in an earlier finished file are reported with that file name', async () => {
  const models = fakeDedupeModels({
    batches: [
      { _id: new ObjectId(A), status: 'completed', fileName: 'jan.xlsx' },
      { _id: new ObjectId(C), status: 'failed', fileName: 'broken.xlsx' },
    ],
    sales: [
      { orderId: 'O1', batchId: new ObjectId(A) },
      { orderId: 'O2', batchId: new ObjectId(C) }, // a failed file never counts
    ],
  });

  const deduper = await createOrderDeduper(new ObjectId(B), models);
  assert.equal(deduper.hasEarlierFiles, true);
  const found = await deduper.findExisting(['O1', 'O2', 'O3', 'O1']);
  assert.deepEqual([...found], [['O1', 'jan.xlsx']]);
});

test('the first file has nothing to compare with and makes no queries', async () => {
  const models = fakeDedupeModels({ batches: [], sales: [] });
  models.SalesRecordModel.aggregate = () => assert.fail('must not query');
  const deduper = await createOrderDeduper(new ObjectId(A), models);
  assert.equal(deduper.hasEarlierFiles, false);
  assert.equal((await deduper.findExisting(['O1'])).size, 0);
});

test('the duplicate note is empty when nothing was skipped', () => {
  assert.equal(describeDuplicates({ rows: 0, orders: 0 }), '');
  assert.equal(
    describeDuplicates({ rows: 1, orders: 1 }),
    'Skipped 1 row (1 order) that were already in an earlier file.'
  );
});

/* ------------------------------ delete cleanup ------------------------------ */

test('after a delete, only customers / products no other file uses are removed', async () => {
  const c1 = new ObjectId();
  const c2 = new ObjectId();
  const p1 = new ObjectId();
  const deleted = { customer: [], product: [] };

  const models = {
    SalesRecordModel: {
      // c2 and nothing else is still used by a remaining sales row.
      async distinct(field, { [field]: { $in } }) {
        const used = field === 'customerRef' ? [c2] : [];
        return $in.filter((id) => used.some((u) => String(u) === String(id)));
      },
    },
    CustomerModel: { async deleteMany({ _id: { $in } }) { deleted.customer = $in; return { deletedCount: $in.length }; } },
    ProductModel: { async deleteMany({ _id: { $in } }) { deleted.product = $in; return { deletedCount: $in.length }; } },
  };

  const result = await removeUnreferencedMasters({ customerRefs: [c1, c2], productRefs: [p1] }, models);

  assert.deepEqual(result, { removedCustomers: 1, removedProducts: 1 });
  assert.deepEqual(deleted.customer.map(String), [String(c1)]);
  assert.deepEqual(deleted.product.map(String), [String(p1)]);
});

/* ------------------------------ file numbers & payload ------------------------------ */

test('finished files are numbered in upload order; others get null', () => {
  const list = withFileNumbers([
    { _id: C, status: 'processing', uploadedAt: '2026-03-01' },
    { _id: B, status: 'completed', uploadedAt: '2026-02-01' },
    { _id: 'f'.repeat(24), status: 'failed', uploadedAt: '2026-02-15' },
    { _id: A, status: 'completed', uploadedAt: '2026-01-01' },
  ]);
  const numberOf = Object.fromEntries(list.map((f) => [f._id, f.fileNumber]));
  assert.deepEqual(numberOf, { [A]: 1, [B]: 2, [C]: null, ['f'.repeat(24)]: null });
});

test('a replayed completed upload carries the duplicate counts too', () => {
  const s = buildBatchSnapshot({
    _id: A, fileName: 'x.xlsx', status: 'completed', duplicateRowsSkipped: 4, duplicateOrdersSkipped: 2,
    newCustomersCreated: 3, existingCustomersLinked: 1, newProductsCreated: 0, existingProductsLinked: 5,
  });
  assert.deepEqual(s.payload.duplicates, { rows: 4, orders: 2 });
  assert.deepEqual(s.payload.customers, { created: 3, existing: 1 });
  assert.deepEqual(s.payload.products, { created: 0, existing: 5 });
});
