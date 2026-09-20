import { Response } from 'express';

/**
 * The members' area speaks a different envelope from the funnel.
 *
 * Funnel and admin routes answer `{ success, data }` / `{ success, error }`.
 * The Boost front end — which is finished, and which we are not redesigning —
 * expects the payload at the top level and errors as `{ code, message }`, with
 * `code` carrying the meaning: the UI branches on `no_attempt_today`,
 * `daily_limit_reached`, `attempt_expired` and `level_locked`, and renders
 * `message` to the member verbatim.
 *
 * So Boost routes get their own two helpers rather than the shared
 * `ResponseUtil`. Two conventions in one service, each used consistently and
 * neither leaking into the other.
 */

/**
 * An error the member is allowed to see.
 *
 * `message` is written for an end user, in English, because the UI prints it
 * without interpretation. `code` is what the UI branches on, so it is part of
 * the contract and must not be reworded casually.
 */
export class BoostError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  /** Extra fields merged into the error body, e.g. `attempt` or `resetsAt`. */
  public readonly extra: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BoostError';
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BoostResponse {
  /** The payload at the top level — no wrapper object. */
  static ok<T extends object>(res: Response, body: T, statusCode = 200): Response {
    return res.status(statusCode).json(body);
  }

  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  static error(
    res: Response,
    statusCode: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {}
  ): Response {
    return res.status(statusCode).json({ code, message, ...extra });
  }
}
