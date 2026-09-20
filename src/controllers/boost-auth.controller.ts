import { Request, Response, NextFunction } from 'express';
import { BoostResponse } from '../utils/boost-response.util.js';
import { login, requestPasswordReset, resetPassword } from '../services/boost-auth.service.js';

/**
 * Sign-in, sign-out and password recovery for members.
 *
 * Responses are the flat shapes in `API.md` — the members' app reads them
 * directly, so there is no `{ success, data }` wrapper here.
 */
export class BoostAuthController {
  /** POST /auth/login */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, remember } = req.body ?? {};
      // Absent means "keep me signed in", which is what the box defaults to.
      const result = await login(email, password, remember !== false);
      BoostResponse.ok(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/logout
   *
   * Sessions are stateless, so there is nothing server-side to tear down: the
   * client drops the token. Kept as an endpoint because the client calls it,
   * and because a future audit log has an obvious home.
   */
  static async logout(_req: Request, res: Response): Promise<void> {
    BoostResponse.ok(res, { ok: true });
  }

  /**
   * POST /auth/forgot-password
   *
   * Always 200, whatever happened — including when the address belongs to
   * nobody, or to someone who took the quiz and never bought. Any other answer
   * turns this into a way to test whether an address is a paying customer.
   *
   * The mock returns `devResetToken` so the flow can be exercised without mail.
   * This deliberately does not: that token is a password reset.
   */
  static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await requestPasswordReset(req.body?.email, req.ip ?? null);
      BoostResponse.ok(res, { ok: true });
    } catch (error) {
      next(error);
    }
  }

  /** POST /auth/reset-password */
  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body ?? {};
      await resetPassword(token, password);
      BoostResponse.ok(res, { ok: true });
    } catch (error) {
      next(error);
    }
  }
}
