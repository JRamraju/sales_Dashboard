import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes/api.routes.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';

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

app.use(helmet());
app.use(cors({ origin: getAllowedOrigins() }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please slow down.' },
  })
);

app.use('/api/v1', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
