import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../utils/logger';
import { routePattern } from './requestLog';

// body-parser's errors carry an HTTP status and a type naming the failure.
interface BodyParserError extends Error {
  status: number;
  type: string;
}

const isBodyParserError = (err: Error): err is BodyParserError =>
  typeof (err as Partial<BodyParserError>).status === 'number' &&
  typeof (err as Partial<BodyParserError>).type === 'string';

const BODY_ERRORS: Record<string, { status: number; error: string }> = {
  'entity.parse.failed': { status: 400, error: 'Request body is not valid JSON' },
  'entity.too.large': { status: 413, error: 'Request body is too large' },
};

/**
 * Client mistakes get a 4xx and a fixed message. Anything else is a 500
 * whose details appear only in development, so a staging or misconfigured
 * deploy never leaks internals.
 */
export const createErrorHandler = (env: NodeJS.ProcessEnv = process.env) => (
  err: Error,
  req: Request,
  res: Response,
  // Express recognizes an error handler by its four parameters.
  _next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(isTooLarge ? 413 : 400).json({
      success: false,
      error: isTooLarge ? 'File is larger than the 50MB upload limit' : err.message,
    });
    return;
  }
  if (err.message.startsWith('Unsupported file type')) {
    res.status(415).json({ success: false, error: err.message });
    return;
  }
  if (isBodyParserError(err) && err.status >= 400 && err.status < 500) {
    const known = BODY_ERRORS[err.type];
    res.status(known?.status ?? err.status).json({
      success: false,
      error: known?.error ?? 'Invalid request body',
    });
    return;
  }

  // The stack goes to the log only; the response never carries it.
  logger.error('unhandled error', { method: req.method, route: routePattern(req), err });
  res.status(500).json({
    success: false,
    error: env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
};
