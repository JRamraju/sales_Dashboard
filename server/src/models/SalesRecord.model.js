import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One document per validated order line item.
 * Rows sharing an orderId belong to the same order.
 */
const salesRecordSchema = new Schema({
  // Covered by the compound index below (it is the leading key).
  batchId: { type: Schema.Types.ObjectId, ref: 'UploadBatch', required: true },
  orderId: { type: String, required: true, index: true },
  orderDate: { type: Date, required: true, index: true }, // critical for range queries & sorting
  customerId: { type: String, required: true },
  customerName: { type: String, required: true },
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  category: { type: String, required: true, index: true },
  region: { type: String, required: true, index: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  totalRevenue: { type: Number, required: true }, // rounded to 2 decimals on ingest
});

// Filtered dashboard queries resolve from this index instead of a full scan.
salesRecordSchema.index({ batchId: 1, orderDate: 1, category: 1, region: 1 });

const SalesRecord =
  mongoose.models.SalesRecord || mongoose.model('SalesRecord', salesRecordSchema);

export default SalesRecord;
