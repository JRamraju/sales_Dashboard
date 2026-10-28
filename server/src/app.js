import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes/api.routes.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';
import { isDbConnected } from './config/db.config.js';
import { redisStatus } from './config/redis.config.js';

/** Allowed browser origins, shared by REST CORS and Socket.io CORS. */
export function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const app = express();

// Parse nested/array query params (?category[]=A&category[]=B) the way axios sends them.
app.set('query parser', 'extended');

// Behind a reverse proxy / load balancer (Render, Railway, Nginx, ...) every
// request arrives from the proxy's address, so the rate limiter would count
// all users as one client. Set TRUST_PROXY to the number of proxy hops
// (usually 1) to use the real client address. Off by default.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

app.use(helmet());
app.use(cors({ origin: getAllowedOrigins() }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Liveness: the process is up.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Readiness: the process can actually serve requests (database connected).
// Redis is reported but does not make the API unready: dashboards only need
// MongoDB, and only uploads need Redis (they answer 503 on their own).
app.get('/health/ready', (req, res) => {
  const database = isDbConnected();
  res.status(database ? 200 : 503).json({
    status: database ? 'ready' : 'unavailable',
    database: database ? 'connected' : 'disconnected',
    redis: redisStatus.state,
  });
});

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    // One dashboard load is 4 analytics calls plus the upload list, and a
    // development server (React strict mode) doubles that, so 600 per 15
    // minutes was easy to hit just by changing filters.
    limit: Number(process.env.RATE_LIMIT_MAX) || 1500,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please slow down.' },
  })
);

app.use('/api/v1', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
