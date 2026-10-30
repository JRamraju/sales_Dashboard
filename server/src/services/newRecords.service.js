import mongoose from 'mongoose';
import SalesRecord from '../models/SalesRecord.model.js';

const { ObjectId } = mongoose.Types;

/** New customers / products listed per file unless the request asks for another number. */
export const DEFAULT_ITEM_LIMIT = 100;
export const MAX_ITEM_LIMIT = 500;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const run = (pipeline) => SalesRecord.aggregate(pipeline).allowDiskUse(true);
const batchesIn = (ids) => ({ batchId: { $in: ids.map((id) => new ObjectId(id)) } });

/* -------------------------------------------------------------------------- */
/* Pipelines: one row per (customer | product, file)                          */
/* -------------------------------------------------------------------------- */

export const customerPairsPipeline = (batchIds) => [
  { $match: batchesIn(batchIds) },
  // Collapse to (customer, file, order) first so `orders` counts DISTINCT orders.
  {
    $group: {
      _id: { customerId: '$customerId', batchId: '$batchId', orderId: '$orderId' },
      customerName: { $first: '$customerName' },
      revenue: { $sum: '$totalRevenue' },
      firstOrderDate: { $min: '$orderDate' },
    },
  },
  {
    $group: {
      _id: { customerId: '$_id.customerId', batchId: '$_id.batchId' },
      customerName: { $first: '$customerName' },
      orders: { $sum: 1 },
      revenue: { $sum: '$revenue' },
      firstOrderDate: { $min: '$firstOrderDate' },
    },
  },
];

export const productPairsPipeline = (batchIds) => [
  { $match: batchesIn(batchIds) },
  {
    $group: {
      _id: { productId: '$productId', batchId: '$batchId' },
      productName: { $first: '$productName' },
      category: { $first: '$category' },
      unitsSold: { $sum: '$quantity' },
      revenue: { $sum: '$totalRevenue' },
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Pure classification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Walks the files oldest to newest and, for each one, returns the rows whose
 * customer / product had not appeared in ANY earlier file.
 *
 * Working from the sales rows (rather than from a stored "created by" flag)
 * keeps the answer right when files are deleted and uploaded again.
 *
 * @param {string[]} orderedBatchIds  file ids, oldest first
 * @param {object[]} pairRows         aggregation rows, `_id` holds batchId and `keyField`
 * @param {'customerId'|'productId'} keyField
 * @returns {Map<string, object[]>}   file id -> its new rows
 */
export function newRowsByFile(orderedBatchIds, pairRows, keyField) {
  const byFile = new Map(orderedBatchIds.map((id) => [id, []]));
  for (const row of pairRows) byFile.get(String(row._id.batchId))?.push(row);

  const seen = new Set();
  const result = new Map();
  for (const id of orderedBatchIds) {
    const rows = byFile.get(id);
    result.set(id, rows.filter((row) => !seen.has(row._id[keyField])));
    for (const row of rows) seen.add(row._id[keyField]);
  }
  return result;
}

const byRevenueThenId = (idOf) => (a, b) => b.revenue - a.revenue || (idOf(a) < idOf(b) ? -1 : 1);

function summarize(rows, toItem, idOf, limit) {
  const sorted = [...rows].sort(byRevenueThenId(idOf));
  return {
    count: sorted.length,
    revenue: round2(sorted.reduce((sum, row) => sum + row.revenue, 0)),
    items: sorted.slice(0, limit).map(toItem),
    truncated: sorted.length > limit,
  };
}

const customerItem = (row) => ({
  customerId: row._id.customerId,
  customerName: row.customerName,
  orders: row.orders,
  revenue: round2(row.revenue),
  firstOrderDate: row.firstOrderDate,
});

const productItem = (row) => ({
  productId: row._id.productId,
  productName: row.productName,
  category: row.category,
  unitsSold: row.unitsSold,
  revenue: round2(row.revenue),
});

const EMPTY = () => ({ count: 0, revenue: 0, items: [], truncated: false });

/**
 * Pure: shapes the response.
 *
 * @param {{ id: string, fileName: string, uploadedAt: Date, fileNumber: number }[]} orderedFiles
 *        EVERY finished file, oldest first (this is what "earlier" means)
 * @param {string[]} selectedIds   the files the dashboard is looking at
 */
export function shapeNewRecords({ orderedFiles, selectedIds, customerRows, productRows, limit }) {
  const selected = new Set(selectedIds);
  const newCustomers = newRowsByFile(orderedFiles.map((f) => f.id), customerRows, 'customerId');
  const newProducts = newRowsByFile(orderedFiles.map((f) => f.id), productRows, 'productId');

  const files = [];
  orderedFiles.forEach((file, index) => {
    if (!selected.has(file.id)) return;

    const isFirstFile = index === 0;
    files.push({
      batchId: file.id,
      fileName: file.fileName,
      fileNumber: file.fileNumber,
      uploadedAt: file.uploadedAt,
      isFirstFile,
      // Everything in the very first file is trivially "new"; that says nothing, so it is left empty.
      comparedWith: orderedFiles
        .slice(0, index)
        .map((f) => ({ batchId: f.id, fileNumber: f.fileNumber, fileName: f.fileName })),
      newCustomers: isFirstFile
        ? EMPTY()
        : summarize(newCustomers.get(file.id), customerItem, (r) => r._id.customerId, limit),
      newProducts: isFirstFile
        ? EMPTY()
        : summarize(newProducts.get(file.id), productItem, (r) => r._id.productId, limit),
    });
  });

  return { files };
}

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * For each selected file: the customers and products that are in it but in
 * none of the files uploaded before it. "Before" always means every earlier
 * finished file, not only the ones that are selected, so File 3 is compared
 * with Files 1 and 2 even when only File 3 is being viewed.
 *
 * Only the rows of files up to the newest selected one are read.
 *
 * @param {{ orderedFiles: object[], selectedIds: string[], limit?: number }} input
 */
export async function getNewRecords({ orderedFiles, selectedIds, limit = DEFAULT_ITEM_LIMIT }) {
  const selected = new Set(selectedIds);
  const lastIndex = orderedFiles.reduce((last, file, i) => (selected.has(file.id) ? i : last), -1);
  if (lastIndex < 0) return { files: [] };

  // A lone first file has nothing earlier to compare with, so skip the queries.
  const scopeIds = orderedFiles.slice(0, lastIndex + 1).map((f) => f.id);
  const [customerRows, productRows] =
    lastIndex === 0
      ? [[], []]
      : await Promise.all([run(customerPairsPipeline(scopeIds)), run(productPairsPipeline(scopeIds))]);

  return shapeNewRecords({ orderedFiles, selectedIds, customerRows, productRows, limit });
}
