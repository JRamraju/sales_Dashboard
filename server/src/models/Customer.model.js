import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One document per distinct customer_id across ALL uploaded files.
 * Created automatically by the upload worker the first time an id is seen;
 * later files reuse it. `firstBatchId` is the file that introduced the
 * customer, which is how the dashboard lists "new customers in file N".
 */
const customerSchema = new Schema({
  customerId: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  firstBatchId: { type: Schema.Types.ObjectId, ref: 'UploadBatch', required: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);

export default Customer;
