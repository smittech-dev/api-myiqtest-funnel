import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../entities/User.entity.js';
import { JwtUtil, AdminTokenPayload } from '../utils/jwt.util.js';
import { AppError } from '../utils/app-error.util.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

/**
 * Guards every /admin route with the JWT issued by POST /admin/auth/login.
 *
 * The user row is re-read on each request rather than trusted from the token.
 * With a 60-day session that is the only practical way to revoke access:
 * setting users.status to anything but 'active' locks the operator out on
 * their next call instead of waiting two months for the token to lapse.
 */
export const adminAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError('Missing bearer token. Sign in to the admin panel first.', 401);
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new AppError('Missing bearer token. Sign in to the admin panel first.', 401);
    }

    const payload = JwtUtil.verifyAdminToken(token);

    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: payload.sub }
    });

    if (!user) {
      throw new AppError('Admin account no longer exists.', 401);
    }
    if (user.status !== 'active') {
      throw new AppError('Admin account is not active.', 403);
    }

    req.admin = { sub: user.id, email: user.email, role: user.role };
    next();
  } catch (error) {
    next(error);
  }
};
