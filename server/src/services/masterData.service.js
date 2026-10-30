import mongoose from 'mongoose';
import Customer from '../models/Customer.model.js';
import Product from '../models/Product.model.js';
import SalesRecord from '../models/SalesRecord.model.js';
import UploadBatch from '../models/UploadBatch.model.js';

const { ObjectId } = mongoose.Types;

/** Cap on invoice (order id) numbers returned per new customer / product. */
export const MAX_INVOICES_PER_ENTITY = 25;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* -------------------------------------------------------------------------- */
/* Duplicate order lines                                                      */
/* -------------------------------------------------------------------------- */

/** Identity of an order line across files. */
export const lineKey = (orderId, productId) => `${orderId}\u0001${productId}`;

/**
 * Which of `docs` (validated rows) already exist in a DIFFERENT file?
 * One indexed query per chunk (index: { orderId, productId }).
 *
 * @returns {Promise<Set<string>>} lineKey(orderId, productId) values that already exist
 */
export async function findExistingLineKeys(docs, batchObjectId) {
  if (docs.length === 0) return new Set();
  const orderIds = [...new Set(docs.map((d) => d.orderId))];

  const found = await SalesRecord.find({ batchId: { $ne: batchObjectId }, orderId: { $in: orderIds } })
    .select('orderId productId -_id')
    .lean();

  return new Set(found.map((r) => lineKey(r.orderId, r.productId)));
}

/* -------------------------------------------------------------------------- */
/* Customer / product resolution during an upload                             */
/* -------------------------------------------------------------------------- */

const isDuplicateKeyError = (err) =>
  err?.code === 11000 || (Array.isArray(err?.writeErrors) && err.writeErrors.every((e) => e.code === 11000));

/**
 * Makes sure every id in `entries` (Map<id, extraFields>) has a master record.
 * Existing records are reused untouched (the current mapping behaviour);
 * missing ones are created with `firstBatchId` = this file. `cache` maps
 * id -> _id for the whole job so each id hits the database once.
 */
async function ensureRecords({ Model, key, entries, cache, createdIds, batchObjectId }) {
  const missing = [...entries.keys()].filter((id) => !cache.has(id));
  if (missing.length === 0) return;

  const now = new Date();
  const ops = missing.map((id) => ({
    updateOne: {
      filter: { [key]: id },
      // The filter's equality field is copied into an upserted document by MongoDB.
      update: { $setOnInsert: { ...entries.get(id), firstBatchId: batchObjectId, createdAt: now } },
      upsert: true,
    },
  }));

  try {
    const result = await Model.bulkWrite(ops, { ordered: false });
    for (const [index, _id] of Object.entries(result.upsertedIds ?? {})) {
      const id = missing[Number(index)];
      cache.set(id, _id);
      createdIds.add(id);
    }
  } catch (err) {
    // Another writer created the same id first (unique index): treat it as existing.
    if (!isDuplicateKeyError(err)) throw err;
  }

  const unresolved = missing.filter((id) => !cache.has(id));
  if (unresolved.length > 0) {
    const docs = await Model.find({ [key]: { $in: unresolved } }).select(`_id ${key}`).lean();
    for (const doc of docs) cache.set(doc[key], doc._id);
  }
}

/**
 * Per-upload helper used by the worker. `attach(docs)` creates any missing
 * customers / products and writes the `customer` / `product` links onto the
 * rows that are about to be inserted, so every sales line points at its
 * master record (new or existing).
 */
export function createMasterResolver(batchObjectId) {
  const customerCache = new Map(); // customerId -> Customer._id
  const productCache = new Map(); // productId -> Product._id
  const newCustomerIds = new Set();
  const newProductIds = new Set();

  return {
    async attach(docs) {
      if (docs.length === 0) return;

      const customers = new Map();
      const products = new Map();
      for (const d of docs) {
        if (!customers.has(d.customerId)) customers.set(d.customerId, { customerName: d.customerName });
        if (!products.has(d.productId)) {
          products.set(d.productId, { productName: d.productName, category: d.category });
        }
      }

      await ensureRecords({
        Model: Customer, key: 'customerId', entries: customers,
        cache: customerCache, createdIds: newCustomerIds, batchObjectId,
      });
      await ensureRecords({
        Model: Product, key: 'productId', entries: products,
        cache: productCache, createdIds: newProductIds, batchObjectId,
      });

      for (const d of docs) {
        d.customer = customerCache.get(d.customerId);
        d.product = productCache.get(d.productId);
      }
    },
    get newCustomers() { return newCustomerIds.size; },
    get newProducts() { return newProductIds.size; },
  };
}

/* -------------------------------------------------------------------------- */
/* Cleanup when a file is re-processed, fails or is deleted                   */
/* -------------------------------------------------------------------------- */

/**
 * Call AFTER the file's sales rows have been deleted. Customers / products
 * this file introduced are either removed (nothing else uses them) or handed
 * to the earliest remaining file that does use them, so "new in file N"
 * stays correct.
 */
export async function releaseMasterData(batchObjectId) {
  for (const { Model, ref } of [
    { Model: Customer, ref: 'customer' },
    { Model: Product, ref: 'product' },
  ]) {
    const owned = await Model.find({ firstBatchId: batchObjectId }).select('_id').lean();
    if (owned.length === 0) continue;
    const ownedIds = owned.map((o) => o._id);

    const usage = await SalesRecord.aggregate([
      { $match: { [ref]: { $in: ownedIds }, batchId: { $ne: batchObjectId } } },
      { $group: { _id: { entity: `$${ref}`, batchId: '$batchId' } } },
    ]).allowDiskUse(true);

    const usedBatchIds = [...new Set(usage.map((u) => String(u._id.batchId)))];
    const rank = new Map();
    if (usedBatchIds.length > 0) {
      const batches = await UploadBatch.find({ _id: { $in: usedBatchIds } }).select('sequence').lean();
      for (const b of batches) rank.set(String(b._id), b.sequence ?? Number.MAX_SAFE_INTEGER);
    }

    // entity -> earliest remaining file that uses it
    const heir = new Map();
    for (const u of usage) {
      const entity = String(u._id.entity);
      const batchId = String(u._id.batchId);
      const current = heir.get(entity);
      if (current === undefined || (rank.get(batchId) ?? Infinity) < (rank.get(current) ?? Infinity)) {
        heir.set(entity, batchId);
      }
    }

    const unused = ownedIds.filter((id) => !heir.has(String(id)));
    if (unused.length > 0) await Model.deleteMany({ _id: { $in: unused } });

    if (heir.size > 0) {
      await Model.bulkWrite(
        [...heir].map(([entity, batchId]) => ({
          updateOne: {
            filter: { _id: new ObjectId(entity) },
            update: { $set: { firstBatchId: new ObjectId(batchId) } },
          },
        })),
        { ordered: false }
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* "New in this file" report for the dashboard                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-entity sales inside one file: revenue, distinct invoices (order ids) and,
 * for products, units sold.
 */
async function salesByEntity(batchObjectId, ref, entityIds) {
  if (entityIds.length === 0) return new Map();

  const rows = await SalesRecord.aggregate([
    { $match: { batchId: batchObjectId, [ref]: { $in: entityIds } } },
    {
      $group: {
        _id: { entity: `$${ref}`, orderId: '$orderId' },
        revenue: { $sum: '$totalRevenue' },
        units: { $sum: '$quantity' },
      },
    },
    { $sort: { '_id.orderId': 1 } },
    {
      $group: {
        _id: '$_id.entity',
        invoices: { $push: '$_id.orderId' },
        revenue: { $sum: '$revenue' },
        units: { $sum: '$units' },
      },
    },
  ]).allowDiskUse(true);

  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        totalOrders: r.invoices.length,
        totalRevenue: round2(r.revenue),
        unitsSold: r.units,
        invoices: r.invoices.slice(0, MAX_INVOICES_PER_ENTITY),
        invoicesTruncated: r.invoices.length > MAX_INVOICES_PER_ENTITY,
      },
    ])
  );
}

const EMPTY_SALES = { totalOrders: 0, totalRevenue: 0, unitsSold: 0, invoices: [], invoicesTruncated: false };

/**
 * New customers / products per selected file, with the invoices they were
 * linked to. The earliest remaining file is the baseline: everything in it is
 * "new" by definition, so only its counts are returned (`isBaseline: true`).
 *
 * @param {string[]} batchIds   files to report on
 * @param {{ limit?: number }} [options]  max customers and max products listed per file
 */
export async function getNewEntitiesByFile(batchIds, { limit = 200 } = {}) {
  if (batchIds.length === 0) return [];

  const [batches, baseline] = await Promise.all([
    UploadBatch.find({ _id: { $in: batchIds } }).select('fileName sequence uploadedAt').lean(),
    UploadBatch.findOne({ status: 'completed' }).sort({ sequence: 1, uploadedAt: 1 }).select('_id').lean(),
  ]);
  batches.sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity) || a.uploadedAt - b.uploadedAt);

  const report = [];
  for (const batch of batches) {
    const isBaseline = baseline ? String(baseline._id) === String(batch._id) : false;
    const [newCustomersCount, newProductsCount] = await Promise.all([
      Customer.countDocuments({ firstBatchId: batch._id }),
      Product.countDocuments({ firstBatchId: batch._id }),
    ]);

    const entry = {
      batchId: String(batch._id),
      fileName: batch.fileName,
      sequence: batch.sequence ?? null,
      isBaseline,
      newCustomersCount,
      newProductsCount,
      newCustomers: [],
      newProducts: [],
      truncated: false,
    };

    if (!isBaseline) {
      const [customers, products] = await Promise.all([
        Customer.find({ firstBatchId: batch._id }).sort({ customerId: 1 }).limit(limit).lean(),
        Product.find({ firstBatchId: batch._id }).sort({ productId: 1 }).limit(limit).lean(),
      ]);
      const [customerSales, productSales] = await Promise.all([
        salesByEntity(batch._id, 'customer', customers.map((c) => c._id)),
        salesByEntity(batch._id, 'product', products.map((p) => p._id)),
      ]);

      entry.newCustomers = customers.map((c) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        ...(customerSales.get(String(c._id)) ?? EMPTY_SALES),
      }));
      entry.newProducts = products.map((p) => ({
        productId: p.productId,
        productName: p.productName,
        category: p.category,
        ...(productSales.get(String(p._id)) ?? EMPTY_SALES),
      }));
      entry.truncated = newCustomersCount > customers.length || newProductsCount > products.length;
    }

    report.push(entry);
  }
  return report;
}
