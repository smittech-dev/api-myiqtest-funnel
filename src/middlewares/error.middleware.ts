import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/app-error.util.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { logger } from '../utils/logger.util.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(`Error processing ${req.method} ${req.originalUrl}:`, err);

  if (err instanceof AppError) {
    ResponseUtil.error(res, err.message, err.statusCode, err.details);
    return;
  }

  // Handle Zod or general validation errors
  if (err.name === 'ZodError') {
    ResponseUtil.error(res, 'Validation error', 400, err.errors);
    return;
  }

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  ResponseUtil.error(res, message, statusCode);
}
