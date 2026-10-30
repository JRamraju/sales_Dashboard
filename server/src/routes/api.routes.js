import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { uploadSingleFile, verifyUploadedFile } from '../middlewares/upload.middleware.js';
import {
  uploadFile,
  listUploads,
  getUpload,
  deleteUpload,
} from '../controllers/upload.controller.js';
import {
  overview,
  trends,
  breakdowns,
  forecast,
  newEntities,
} from '../controllers/analytics.controller.js';

const router = Router();

// Uploads are the expensive operation, so they get their own tighter limit.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many uploads. Please wait a few minutes and try again.' },
});

/* ------------------------------- Uploads --------------------------------- */
router.post('/uploads', uploadLimiter, uploadSingleFile, verifyUploadedFile, uploadFile);
router.get('/uploads', listUploads);
router.get('/uploads/:batchId', getUpload);
router.delete('/uploads/:batchId', deleteUpload);

/* ------------------------------ Analytics -------------------------------- */
router.get('/analytics/overview', overview);
router.get('/analytics/trends', trends);
router.get('/analytics/breakdowns', breakdowns);
router.get('/analytics/forecast', forecast);
router.get('/analytics/new-entities', newEntities);

export default router;
