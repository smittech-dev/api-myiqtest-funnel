import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { BoostJwtUtil } from '../utils/boost-jwt.util.js';
import { BoostError } from '../utils/boost-response.util.js';
import { hasTrainingAccess, findSubscription } from '../services/boost-subscription.service.js';
import type { BoostSession } from '../types/boost.types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      member?: BoostSession;
    }
  }
}

/**
 * Guards every members' route with the JWT issued by POST /boost-api/v1/auth/login.
 *
 * The customer row is re-read on each request rather than trusted from the
 * token — the same reasoning as the admin guard, plus one Boost-specific job:
 * comparing the token's `iat` against `password_set_at`, which is how a password
 * reset signs the member out of every device without a sessions table.
 */
export const boostAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    const payload = BoostJwtUtil.verify(token);

    const customer = await AppDataSource.getRepository(Customer).findOne({
      where: { id: payload.sub }
    });

    if (!customer) {
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    // The account has been stripped of its credential — treat it as signed out
    // rather than half-authenticated.
    if (!customer.password_set_at) {
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    if (BoostJwtUtil.isStale(payload, customer.password_set_at)) {
      throw new BoostError(
        401,
        'session_expired',
        'Your password was changed, so you have been signed out. Please sign in again.'
      );
    }

    req.member = { customerId: customer.id, email: customer.email };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Gates the training features behind a live subscription.
 *
 * Deliberately *not* part of `boostAuth`: a cancelled member must still be able
 * to sign in and see their history, scores and ranking — the front end's
 * `RequireSubscription` shows them a "membership required" screen rather than a
 * login page, and that only works if the session itself is valid.
 *
 * `hasAccess()` in the client does the same test for routing. This is the copy
 * that counts.
 */
export const requireBoostSubscription = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.member) {
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    const subscription = await findSubscription(req.member.customerId);

    if (!hasTrainingAccess(subscription)) {
      // Never 401 here: the client drops the session on any 401, which would
      // bounce a cancelled member to the login screen instead of the page that
      // offers to restart their membership.
      throw new BoostError(
        403,
        'subscription_required',
        'Your membership is not active, so training is paused. Your scores and streak are still here — restart any time.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};
