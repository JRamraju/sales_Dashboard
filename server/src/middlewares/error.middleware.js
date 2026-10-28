import multer from 'multer';

/**
 * Error with an HTTP status. Throw it from controllers/middlewares and the
 * global handler below turns it into a consistent JSON response.
 */
export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Global centralized error formatting. Every error response has the shape
 *   { "message": string, "details"?: any }
 * (Express 5 forwards rejected promises from async handlers here automatically.)
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = `File is too large. Maximum allowed size is ${Number(process.env.MAX_UPLOAD_MB) || 50} MB.`;
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      message = 'Unexpected file field. Send the file in the "file" form field.';
    } else {
      status = 400;
      message = `Upload error: ${err.message}`;
    }
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for '${err.path}'.`;
  } else if (err.name === 'ValidationError' && err.errors) {
    // Mongoose schema validation
    status = 400;
    message = 'Validation failed.';
    details = Object.values(err.errors).map((e) => e.message);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON in request body.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large.';
  } else if (
    err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoNetworkTimeoutError'
  ) {
    status = 503;
    message = 'The database is temporarily unavailable. Please try again shortly.';
  }

  // Only real server faults are worth a stack trace in the log; a 400/404 is
  // the caller's mistake and would just be noise.
  if (status >= 500) {
    console.error('[error]', err);
    if (process.env.NODE_ENV === 'production' && status === 500) message = 'Internal server error';
  }

  if (res.headersSent) return;

  res.status(status).json({
    message,
    ...(details !== undefined && { details }),
    ...(process.env.NODE_ENV !== 'production' && status >= 500 && { stack: err.stack }),
  });
}
