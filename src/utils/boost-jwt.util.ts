import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config/env.config.js';
import { BoostError } from './boost-response.util.js';

/**
 * Member session tokens for the myIQ Cognitive Training Program.
 *
 * Separate from `JwtUtil` (the admin panel) on purpose, and signed with a
 * different secret. One shared secret would make an admin token a valid member
 * token and — the direction that actually matters — a member token a valid
 * admin token. The `typ` claim is a second, independent check, so even a
 * deployment that misconfigures both secrets to the same value still refuses a
 * token minted for the other audience.
 */

export interface BoostTokenPayload {
  /** customers.id */
  sub: string;
  email: string;
  typ: 'boost';
  /** Issued-at, in seconds. Compared against `customers.password_set_at`. */
  iat?: number;
  exp?: number;
}

export class BoostJwtUtil {
  /**
   * @param remember the "Keep me signed in" box. Unticked sessions are short,
   *   which matters on the shared and borrowed devices a lot of members use.
   */
  static sign(customerId: string, email: string, remember = true): string {
    const options: SignOptions = {
      expiresIn: (remember
        ? config.boost.jwtExpiresIn
        : config.boost.jwtShortExpiresIn) as SignOptions['expiresIn']
    };

    return jwt.sign({ sub: customerId, email, typ: 'boost' }, config.boost.jwtSecret, options);
  }

  /**
   * Throws a 401 the front end knows how to handle: any 401 makes it drop the
   * session and return to the login screen.
   */
  static verify(token: string): BoostTokenPayload {
    let payload: BoostTokenPayload;

    try {
      payload = jwt.verify(token, config.boost.jwtSecret) as BoostTokenPayload;
    } catch (error: any) {
      if (error?.name === 'TokenExpiredError') {
        throw new BoostError(401, 'session_expired', 'Your session has expired. Please sign in again.');
      }
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    // An admin token carries no `typ`, so it cannot pass here even if the
    // secrets were ever to match.
    if (payload.typ !== 'boost') {
      throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
    }

    return payload;
  }

  /**
   * Whether a token predates the account's current password.
   *
   * This is what makes "resetting your password signs you out everywhere" true
   * without a sessions table: the reset writes `password_set_at`, and every
   * token issued before that instant stops verifying on its next request.
   *
   * Compared with no slack, deliberately. `iat` is in whole seconds while
   * `password_set_at` has milliseconds, and flooring the latter is what makes
   * the two comparable: a session that signs in *after* a reset always has
   * `iat >= floor(password_set_at)`, so it survives, while a session from any
   * earlier second does not. Adding a second of tolerance here would let the
   * token issued in the second before a reset outlive it — which is precisely
   * the token a stolen-password reset is meant to kill.
   *
   * The remaining gap is sub-second: a login and a reset inside the same wall
   * clock second cannot be told apart at this precision, and `iat` is not ours
   * to make finer.
   */
  static isStale(payload: BoostTokenPayload, passwordSetAt: Date | null): boolean {
    if (!passwordSetAt || !payload.iat) return false;
    return payload.iat < Math.floor(passwordSetAt.getTime() / 1000);
  }
}
