import { AppDataSource } from '../config/database.config.js';
import { User } from '../entities/User.entity.js';
import { AppError } from '../utils/app-error.util.js';
import { JwtUtil } from '../utils/jwt.util.js';
import { PasswordUtil } from '../utils/password.util.js';
import { logger } from '../utils/logger.util.js';
import { AdminLoginResult, AdminUserProfile } from '../types/admin.types.js';

/** Every admin carries this role; there is no role management by design. */
export const ADMIN_ROLE = 'admin';

export class AdminAuthService {
  private userRepository = AppDataSource.getRepository(User);

  private toProfile(user: User): AdminUserProfile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    };
  }

  /**
   * Verifies credentials and issues a 60-day session token.
   *
   * A missing user and a wrong password return the same message on purpose —
   * distinguishing them tells an attacker which admin emails exist.
   */
  async login(email: string, password: string): Promise<AdminLoginResult> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail }
    });

    if (!user) {
      logger.warn(`Admin login failed: no user for ${normalizedEmail}`);
      throw new AppError('Invalid email or password.', 401);
    }

    const passwordMatches = await PasswordUtil.compare(password, user.password_hash);
    if (!passwordMatches) {
      logger.warn(`Admin login failed: bad password for ${normalizedEmail}`);
      throw new AppError('Invalid email or password.', 401);
    }

    if (user.status !== 'active') {
      throw new AppError('Admin account is not active.', 403);
    }

    const token = JwtUtil.signAdminToken({
      sub: user.id,
      email: user.email,
      role: user.role
    });

    logger.info(`Admin login succeeded for ${normalizedEmail}`);

    return {
      token,
      token_type: 'Bearer',
      expires_in: JwtUtil.expiresInSeconds(token),
      user: this.toProfile(user)
    };
  }

  /** Backs GET /admin/auth/me so the panel can restore a session on reload. */
  async getProfile(userId: string): Promise<AdminUserProfile> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new AppError('Admin account no longer exists.', 401);
    }
    return this.toProfile(user);
  }

  /**
   * Creates an admin. Used by the `npm run create:admin` script — there is no
   * public registration endpoint, so accounts are provisioned from the server.
   */
  async createAdmin(name: string, email: string, password: string): Promise<AdminUserProfile> {
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await this.userRepository.findOne({
      where: { email: normalizedEmail }
    });
    if (existing) {
      throw new AppError(`An admin with email ${normalizedEmail} already exists.`, 409);
    }

    const user = this.userRepository.create({
      name: name.trim(),
      email: normalizedEmail,
      password_hash: await PasswordUtil.hash(password),
      role: ADMIN_ROLE,
      status: 'active'
    });

    await this.userRepository.save(user);
    return this.toProfile(user);
  }

  /** Password reset is server-side only; the panel exposes no reset flow. */
  async setPassword(email: string, password: string): Promise<AdminUserProfile> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail }
    });
    if (!user) {
      throw new AppError(`No admin found with email ${normalizedEmail}.`, 404);
    }

    user.password_hash = await PasswordUtil.hash(password);
    await this.userRepository.save(user);
    return this.toProfile(user);
  }
}

export const adminAuthService = new AdminAuthService();
