import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Customer master record: one document per distinct `customer_id` ever seen in
 * an uploaded sales file.
 *
 * Records are created automatically by the upload worker the first time an id
 * appears (see masterData.service.js). An existing record is never modified by
 * a later upload; it is only linked to the new sales rows.
 */
const customerSchema = new Schema({
  // The id exactly as written in the file (already trimmed by the row validator).
  customerId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  // Upload that first brought this customer in (used for the per-upload "new customers" count).
  createdByBatchId: { type: Schema.Types.ObjectId, ref: 'UploadBatch', index: true },
  createdAt: { type: Date, default: Date.now },
});

const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);

export default Customer;
