import bcrypt from 'bcryptjs';
import { config } from '../config/env.config.js';

/**
 * Bcrypt hashing, shared by the two kinds of account that have real passwords:
 * admin users, and customers once they buy.
 *
 * The funnel still seeds `customers.password_hash` with a throwaway sha256
 * value at quiz submission — that one is not a credential and nothing compares
 * against it. It is replaced with a bcrypt hash by the welcome email, which is
 * what issues the customer their myIQ Cognitive Training Program password. `password_set_at` is
 * the column that tells the two apart.
 */
export class PasswordUtil {
  static async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, config.admin.bcryptRounds);
  }

  static async compare(plainText: string, hash: string): Promise<boolean> {
    // A malformed or empty stored hash must fail closed, not throw.
    if (!hash) return false;
    try {
      return await bcrypt.compare(plainText, hash);
    } catch {
      return false;
    }
  }
}
