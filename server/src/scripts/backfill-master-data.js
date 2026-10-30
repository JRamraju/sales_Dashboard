/**
 * One-time migration for data uploaded BEFORE the multi-file flow existed.
 *
 *   npm run migrate:master-data
 *
 * 1. Numbers old files by upload date (File 1, File 2, ...), keeping any existing numbers.
 * 2. Walks the files in that order and creates a Customer / Product for every
 *    id the first time it appears (that file becomes its `firstBatchId`).
 * 3. Links every existing sales row to its customer / product.
 * 4. Stores the "new customers / products" counts on each file.
 *
 * Safe to run twice: existing masters are kept and already-linked rows are skipped.
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.config.js';
import Counter from '../src/models/Counter.model.js';
import UploadBatch from '../src/models/UploadBatch.model.js';
import SalesRecord from '../src/models/SalesRecord.model.js';
import Customer from '../src/models/Customer.model.js';
import Product from '../src/models/Product.model.js';

const OPS_PER_BULK = 500;

async function bulkInChunks(Model, ops) {
  for (let i = 0; i < ops.length; i += OPS_PER_BULK) {
    await Model.bulkWrite(ops.slice(i, i + OPS_PER_BULK), { ordered: false });
  }
}

async function numberBatches() {
  const batches = await UploadBatch.find().sort({ sequence: 1, uploadedAt: 1 }).select('sequence').lean();
  let max = batches.reduce((m, b) => Math.max(m, b.sequence ?? 0), 0);
  for (const b of batches.filter((x) => x.sequence == null)) {
    max += 1;
    await UploadBatch.updateOne({ _id: b._id }, { sequence: max });
  }
  await Counter.updateOne({ _id: 'uploadBatch' }, { $max: { seq: max } }, { upsert: true });
  return UploadBatch.find({ status: 'completed' }).sort({ sequence: 1 }).select('fileName sequence').lean();
}

async function backfillEntity({ Model, key, ref, nameFields, batch }) {
  // Distinct ids in this file that are not linked yet.
  const rows = await SalesRecord.aggregate([
    { $match: { batchId: batch._id, [ref]: { $exists: false } } },
    {
      $group: {
        _id: `$${key}`,
        ...Object.fromEntries(nameFields.map((f) => [f, { $first: `$${f}` }])),
      },
    },
  ]).allowDiskUse(true);
  if (rows.length === 0) return;

  // Create the ones never seen in an earlier file (firstBatchId = this file).
  await bulkInChunks(
    Model,
    rows.map((r) => ({
      updateOne: {
        filter: { [key]: r._id },
        update: {
          $setOnInsert: {
            ...Object.fromEntries(nameFields.map((f) => [f, r[f]])),
            firstBatchId: batch._id,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }))
  );

  // Link this file's rows to the master records.
  const masters = await Model.find({ [key]: { $in: rows.map((r) => r._id) } }).select(`_id ${key}`).lean();
  await bulkInChunks(
    SalesRecord,
    masters.map((m) => ({
      updateMany: { filter: { batchId: batch._id, [key]: m[key] }, update: { $set: { [ref]: m._id } } },
    }))
  );
}

async function main() {
  await connectDB();
  await Promise.all([Customer.init(), Product.init()]); // make sure the unique indexes exist

  const batches = await numberBatches();
  console.log(`[backfill] ${batches.length} completed file(s)`);

  for (const batch of batches) {
    await backfillEntity({
      Model: Customer, key: 'customerId', ref: 'customer', nameFields: ['customerName'], batch,
    });
    await backfillEntity({
      Model: Product, key: 'productId', ref: 'product', nameFields: ['productName', 'category'], batch,
    });

    const [newCustomersCount, newProductsCount] = await Promise.all([
      Customer.countDocuments({ firstBatchId: batch._id }),
      Product.countDocuments({ firstBatchId: batch._id }),
    ]);
    await UploadBatch.updateOne({ _id: batch._id }, { newCustomersCount, newProductsCount });
    console.log(`[backfill] File ${batch.sequence} (${batch.fileName}): ${newCustomersCount} new customers, ${newProductsCount} new products`);
  }

  await SalesRecord.createIndexes(); // adds the { orderId, productId } duplicate-check index
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('[backfill] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
