import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { BoostError, BoostResponse } from '../utils/boost-response.util.js';
import { AppError } from '../utils/app-error.util.js';
import { logger } from '../utils/logger.util.js';

/**
 * Error handler for the members' API.
 *
 * Mounted on the Boost router so these routes answer in the shape their client
 * understands — `{ code, message }` at the top level — while the funnel and
 * admin routes keep `{ success, error }` through the global handler.
 *
 * `code` is part of the contract: the app branches on `no_attempt_today`,
 * `daily_limit_reached`, `attempt_expired` and `level_locked`, and a 401 of any
 * kind makes it drop the session and return to the login screen. `message` is
 * rendered to the member verbatim, so it is written for them, in English.
 */
export function boostErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof BoostError) {
    // Expected outcomes — a locked level, a used-up day — are the product
    // working, not faults. Only log the ones that indicate something wrong.
    if (err.statusCode >= 500) {
      logger.error(`Boost error on ${req.method} ${req.originalUrl}:`, err);
    }
    BoostResponse.error(res, err.statusCode, err.code, err.message, err.extra);
    return;
  }

  if (err instanceof ZodError) {
    const first = err.errors[0];
    BoostResponse.error(
      res,
      422,
      'invalid_request',
      first?.message ?? 'Some of the details you sent were not valid.'
    );
    return;
  }

  // Raised by shared services that predate this module and speak the funnel's
  // error type. Carry the status across rather than flattening it to a 500.
  if (err instanceof AppError) {
    logger.error(`Boost error on ${req.method} ${req.originalUrl}:`, err);
    BoostResponse.error(res, err.statusCode, 'error', err.message);
    return;
  }

  logger.error(`Unhandled boost error on ${req.method} ${req.originalUrl}:`, err);

  // Never echo an internal message to a member: it is as likely to be a
  // driver's description of our schema as anything they could act on.
  BoostResponse.error(res, 500, 'server_error', 'Something went wrong on our side. Please try again.');
}
