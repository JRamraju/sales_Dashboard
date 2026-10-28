import mongoose from 'mongoose';

/**
 * Opens the MongoDB connection pool used by the API and the upload worker.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
  }

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

  // Optional one-time maintenance: make the database's indexes match the
  // schemas (creates missing ones and DROPS ones the schemas no longer declare,
  // such as the old single-field indexes on SalesRecord). Models must already
  // be imported, which they are by the time the server or worker calls this.
  if (process.env.SYNC_INDEXES === 'true') {
    await mongoose.syncIndexes();
    console.log('[mongo] indexes synced with the schemas');
  }

  return mongoose.connection;
}

/** True while the driver has a live connection (used by /health/ready). */
export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
