import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config/env.config.js';
import { AppError } from './app-error.util.js';

export interface AdminTokenPayload {
  sub: string; // users.id
  email: string;
  role: string;
}

export class JwtUtil {
  /** Issues a 60-day admin session token (ADMIN_JWT_EXPIRES_IN). */
  static signAdminToken(payload: AdminTokenPayload): string {
    const options: SignOptions = {
      expiresIn: config.admin.jwtExpiresIn as SignOptions['expiresIn']
    };
    return jwt.sign(payload, config.admin.jwtSecret, options);
  }

  static verifyAdminToken(token: string): AdminTokenPayload {
    try {
      return jwt.verify(token, config.admin.jwtSecret) as AdminTokenPayload;
    } catch (error: any) {
      if (error?.name === 'TokenExpiredError') {
        throw new AppError('Session expired. Please sign in again.', 401);
      }
      throw new AppError('Invalid authentication token.', 401);
    }
  }

  /** Seconds until the issued token expires, for the login response. */
  static expiresInSeconds(token: string): number {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    if (!decoded?.exp) return 0;
    return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
  }
}
