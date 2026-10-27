import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { ApiError } from './error.middleware.js';

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);

// Browsers report CSV/Excel files under several MIME types depending on the OS
// and on whether Excel is installed, so the extension is checked as well.
const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 50;

/** Uploaded files wait here until the background worker has parsed them. */
export const uploadDir = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'sales-uploads');

// Disk storage (not memory): the file path travels through the Redis job, and
// large files don't sit in the API process's heap.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new ApiError(400, 'Only .csv and .xlsx files are supported.'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
});

/** Accepts a single file in the multipart field named "file". */
export const uploadSingleFile = upload.single('file');
