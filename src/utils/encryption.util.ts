import crypto from 'crypto';
import { config } from '../config/env.config.js';
import { AppError } from './app-error.util.js';

/**
 * Opaque, reversible tokens for the numeric ids that appear in URLs.
 *
 * The point is not confidentiality — a quiz id is not a secret — but
 * **non-enumerability**: `?quiz_id=8421` invites someone to try 8422 and read
 * a stranger's result. A token that cannot be incremented closes that off.
 *
 * ## Why the token is 22 characters
 *
 * The original scheme hex-encoded a 16-byte IV and the ciphertext, joined them
 * with a colon, and base64'd the result — encoding the same bytes twice and
 * producing 87 characters to carry four digits. This one encrypts a single
 * 16-byte block and base64url-encodes it directly: 22 characters, same
 * security properties, a quarter of the length.
 *
 * ## Why a single-block cipher and no IV
 *
 * One AES block is exactly a pseudorandom permutation of 128 bits, which is the
 * primitive this needs. ECB's reputation comes from its use across *many*
 * blocks, where repeated plaintext blocks produce repeated ciphertext; with a
 * single block there is nothing to repeat and the mode reduces to the bare
 * permutation.
 *
 * Dropping the IV makes the token deterministic — one quiz always has one
 * token. That is a feature here: the same result link can be regenerated in an
 * email, a report and the admin panel and still be the same URL.
 *
 * ## Why the tag
 *
 * Without it, every 16-byte string decrypts to *some* 64-bit number, so an
 * attacker could submit random tokens and occasionally land on a real quiz. The
 * block therefore carries the id alongside a keyed tag over that id, and a
 * token whose tag does not recompute is rejected — leaving a 1-in-2^64 chance
 * of a forged token being accepted.
 */

const ALGORITHM = 'aes-256-ecb';
const LEGACY_ALGORITHM = 'aes-256-cbc';

const SECRET = config.encryptionKey || 'iq_funnel_secret_key_2026';

/**
 * Two keys from one secret, for domain separation: the key that encrypts the
 * block must not also be the key that authenticates its contents.
 */
const CIPHER_KEY = crypto.createHash('sha256').update(SECRET).digest();
const TAG_KEY = crypto.createHash('sha256').update(`${SECRET}:tag`).digest();

const ID_BYTES = 8;
const TAG_BYTES = 8;
const BLOCK_BYTES = ID_BYTES + TAG_BYTES;

/** The legacy scheme's key. Unchanged, so tokens already in the wild still open. */
const LEGACY_KEY = CIPHER_KEY;

/** Keyed tag over the id bytes, truncated to the space the block has left. */
function tagFor(idBytes: Buffer): Buffer {
  return crypto.createHmac('sha256', TAG_KEY).update(idBytes).digest().subarray(0, TAG_BYTES);
}

export class EncryptionUtil {
  /**
   * Encrypt a string or number to a URL-safe token.
   *
   * Numeric input takes the short path. Anything else falls back to the legacy
   * scheme, because this format carries 64 bits and nothing wider — no caller
   * does that today, but failing loudly later is worse than the fallback.
   */
  static encrypt(plainText: string | number): string {
    const text = String(plainText);

    if (!/^\d+$/.test(text)) {
      return this.encryptLegacy(text);
    }

    let value: bigint;
    try {
      value = BigInt(text);
    } catch {
      return this.encryptLegacy(text);
    }

    if (value < 0n || value > 0xffffffffffffffffn) {
      return this.encryptLegacy(text);
    }

    const block = Buffer.alloc(BLOCK_BYTES);
    block.writeBigUInt64BE(value, 0);
    tagFor(block.subarray(0, ID_BYTES)).copy(block, ID_BYTES);

    const cipher = crypto.createCipheriv(ALGORITHM, CIPHER_KEY, null);
    // One block in, one block out — the padding a second block would add is
    // exactly the length this format exists to avoid.
    cipher.setAutoPadding(false);

    return Buffer.concat([cipher.update(block), cipher.final()]).toString('base64url');
  }

  /** Decrypt a token produced by either scheme. */
  static decrypt(cipherText: string): string {
    const short = this.tryDecryptShort(cipherText);
    if (short !== null) return short;

    return this.decryptLegacy(cipherText);
  }

  /**
   * The current format, or null when this is not one.
   *
   * Returning null rather than throwing is what lets `decrypt` fall through to
   * the legacy format without treating a perfectly good old token as an error.
   */
  private static tryDecryptShort(cipherText: string): string | null {
    let raw: Buffer;
    try {
      raw = Buffer.from(cipherText, 'base64url');
    } catch {
      return null;
    }

    if (raw.length !== BLOCK_BYTES) return null;

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, CIPHER_KEY, null);
      decipher.setAutoPadding(false);
      const block = Buffer.concat([decipher.update(raw), decipher.final()]);

      const idBytes = block.subarray(0, ID_BYTES);
      const tag = block.subarray(ID_BYTES);

      // Constant-time, because a token is attacker-supplied and a timing
      // difference here would leak how much of a forged tag was right.
      if (!crypto.timingSafeEqual(tag, tagFor(idBytes))) return null;

      return idBytes.readBigUInt64BE(0).toString();
    } catch {
      return null;
    }
  }

  /* ── the scheme this replaced ───────────────────────────────────────────── */

  /**
   * Still here because tokens from it are in emails and reports that were sent
   * before the change, and those links have to keep working. Nothing new is
   * written in this format for a numeric id.
   */
  private static encryptLegacy(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(LEGACY_ALGORITHM, LEGACY_KEY, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return Buffer.from(`${iv.toString('hex')}:${encrypted}`, 'utf8').toString('base64url');
  }

  private static decryptLegacy(cipherText: string): string {
    try {
      const combined = Buffer.from(cipherText, 'base64url').toString('utf8');
      const [ivHex, encryptedHex] = combined.split(':');

      if (!ivHex || !encryptedHex) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, LEGACY_KEY, iv);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      throw new AppError('Invalid or corrupted quiz ID', 400);
    }
  }

  /* ── ids ────────────────────────────────────────────────────────────────── */

  /** Helper to encrypt a numeric/bigint id. */
  static encryptId(id: number | string): string {
    return this.encrypt(id);
  }

  /** Helper to decrypt back to a numeric id. */
  static decryptId(encryptedId: string): string {
    const decrypted = this.decrypt(encryptedId);
    if (!/^\d+$/.test(decrypted)) {
      throw new AppError('Decrypted quiz ID is not a valid identifier', 400);
    }
    return decrypted;
  }

  /**
   * The id behind a token, or null when the token is not one of ours.
   *
   * For callers that want to *try* a lookup — the admin search, which accepts
   * either a raw id or a token pasted from a link — rather than treating a
   * miss as a client error.
   */
  static tryDecryptId(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      return this.decryptId(trimmed);
    } catch {
      return null;
    }
  }
}
