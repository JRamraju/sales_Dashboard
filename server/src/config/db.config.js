import mongoose from 'mongoose';

/**
 * Opens the MongoDB connection pool used by the API and the upload worker.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  console.log()

  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[mongo] disconnected');
  });

  await mongoose.connect(uri, {
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 20,
    serverSelectionTimeoutMS: 8000,
  });

  console.log(`[mongo] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
