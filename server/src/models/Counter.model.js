import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Tiny atomic counters (used to number uploaded files 1, 2, 3 ...). */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

/** Next value of a named counter; safe under concurrent uploads. */
export async function nextSequence(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', lean: true }
  );
  return doc.seq;
}

export default Counter;
