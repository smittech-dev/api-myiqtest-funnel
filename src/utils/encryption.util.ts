import crypto from 'crypto';
import { config } from '../config/env.config.js';
import { AppError } from './app-error.util.js';

// Derive 32-byte key from app secret
const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = crypto
  .createHash('sha256')
  .update(config.encryptionKey || 'iq_funnel_secret_key_2026')
  .digest();
const IV_LENGTH = 16;

export class EncryptionUtil {
  /**
   * Encrypt any string or number to a URL-safe encrypted string
   */
  static encrypt(plainText: string | number): string {
    const text = String(plainText);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Combine IV + encrypted text and convert to base64url for safe transport
    const combined = `${iv.toString('hex')}:${encrypted}`;
    return Buffer.from(combined, 'utf8').toString('base64url');
  }

  /**
   * Decrypt URL-safe encrypted string back to plaintext
   */
  static decrypt(cipherText: string): string {
    try {
      const combined = Buffer.from(cipherText, 'base64url').toString('utf8');
      const [ivHex, encryptedHex] = combined.split(':');

      if (!ivHex || !encryptedHex) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      throw new AppError('Invalid or corrupted quiz ID', 400);
    }
  }

  /**
   * Helper to encrypt numeric/bigint ID
   */
  static encryptId(id: number | string): string {
    return this.encrypt(id);
  }

  /**
   * Helper to decrypt back to numeric ID
   */
  static decryptId(encryptedId: string): string {
    const decrypted = this.decrypt(encryptedId);
    if (!/^\d+$/.test(decrypted)) {
      throw new AppError('Decrypted quiz ID is not a valid identifier', 400);
    }
    return decrypted;
  }
}
