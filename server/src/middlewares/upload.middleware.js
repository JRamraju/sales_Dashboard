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

// Created once at load time instead of on every request.
fs.mkdirSync(uploadDir, { recursive: true });

// Disk storage (not memory): the file path travels through the Redis job, and
// large files don't sit in the API process's heap.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
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

const removeFile = (filePath) => fs.promises.rm(filePath, { force: true }).catch(() => {});

/**
 * Looks inside the saved file instead of trusting its name and MIME type, both
 * of which the client chooses. An .xlsx is a ZIP archive (starts with "PK"), a
 * CSV is UTF-8 text (no NUL bytes). Rejecting a wrong or empty file here gives
 * the user an immediate 400 instead of a background job that fails later.
 * Runs after multer; on rejection it deletes the temp file.
 */
export async function verifyUploadedFile(req, res, next) {
  const file = req.file;
  if (!file) return next(); // the controller reports the missing file

  try {
    if (file.size === 0) {
      throw new ApiError(400, 'The uploaded file is empty.');
    }

    const handle = await fs.promises.open(file.path, 'r');
    let head;
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b; // "PK"
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.xlsx' && !isZip) {
      throw new ApiError(
        400,
        'This file is not a valid .xlsx workbook. (Older .xls files must be re-saved as .xlsx.)'
      );
    }
    if (ext === '.csv' && (isZip || head.includes(0))) {
      throw new ApiError(
        400,
        'This file is not a UTF-8 CSV. Re-save it as "CSV UTF-8" or upload it as .xlsx.'
      );
    }

    next();
  } catch (err) {
    await removeFile(file.path);
    next(err);
  }
}

/**
 * Temp files normally disappear when the worker finishes. After a crash they
 * would stay forever, so on start-up anything older than a day is removed.
 */
export async function cleanupStaleUploads(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const entries = await fs.promises.readdir(uploadDir, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(uploadDir, entry.name);
      const { mtimeMs } = await fs.promises.stat(full);
      if (mtimeMs < cutoff) {
        await removeFile(full);
        removed += 1;
      }
    }
    if (removed > 0) console.log(`[upload] removed ${removed} stale temp file(s) from ${uploadDir}`);
  } catch (err) {
    console.warn('[upload] stale temp file cleanup skipped:', err.message);
  }
}
