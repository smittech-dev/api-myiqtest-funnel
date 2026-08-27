import { Request, Response, NextFunction } from 'express';
import { adminAuthService } from '../services/admin-auth.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { AppError } from '../utils/app-error.util.js';

export class AdminAuthController {
  /**
   * POST /admin/auth/login
   * The only unauthenticated admin endpoint. No registration, no reset.
   */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const data = await adminAuthService.login(email, password);
      ResponseUtil.success(res, data, 'Signed in successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/auth/me
   * Lets the panel restore a session on reload without a fresh login.
   */
  static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.admin) {
        throw new AppError('Not authenticated.', 401);
      }
      const data = await adminAuthService.getProfile(req.admin.sub);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /admin/auth/logout
   * Tokens are stateless, so this only tells the client to drop its copy. It
   * exists so the panel has one call to make; real revocation is by setting
   * the user's status to inactive.
   */
  static async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ResponseUtil.success(res, null, 'Signed out. Discard the token on the client.');
    } catch (error) {
      next(error);
    }
  }
}
