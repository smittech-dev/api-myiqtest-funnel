import { config } from '../config/env.config.js';
import { logger } from '../utils/logger.util.js';

/**
 * Subset of the Reoon verifier response we rely on.
 * https://emailverifier.reoon.com/
 */
interface ReoonResponse {
  email?: string;
  status?: string;
  overall_score?: number;
  is_safe_to_send?: boolean;
  is_disposable?: boolean;
  error?: string;
  message?: string;
}

export interface EmailVerificationResult {
  /** What goes into customers.email_verified. */
  verified: boolean;
  /** Reoon's 0-100 confidence, when it answered. */
  score: number | null;
  /** Reoon's own verdict: valid, invalid, disposable, catch_all, unknown, … */
  status: string | null;
  /** Set when the check could not be completed (disabled, misconfigured, provider down). */
  skippedReason: string | null;
}

export class EmailVerificationService {
  /**
   * Ask Reoon whether an address looks real.
   *
   * Never throws. A provider outage must not stop someone submitting their quiz, so
   * any failure resolves to `verified: false` with a reason — deliberately the same
   * outcome as a genuine failed check, since we cannot prove the address is good.
   */
  async verify(email: string): Promise<EmailVerificationResult> {
    const skipped = (reason: string): EmailVerificationResult => ({
      verified: false,
      score: null,
      status: null,
      skippedReason: reason
    });

    if (!config.emailVerification.enabled) {
      return skipped('email verification disabled (EMAIL_VERIFICATION_ENABLED=false)');
    }

    if (!config.emailVerification.apiKey) {
      logger.warn('Email verification is enabled but REOON_API_KEY is empty — skipping');
      return skipped('REOON_API_KEY is not configured');
    }

    const url = new URL(config.emailVerification.apiUrl);
    url.searchParams.set('email', email);
    url.searchParams.set('key', config.emailVerification.apiKey);
    url.searchParams.set('mode', config.emailVerification.mode);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.emailVerification.timeoutMs);

    let payload: ReoonResponse;
    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        logger.warn(`Reoon returned HTTP ${response.status} for ${email}`);
        return skipped(`provider returned HTTP ${response.status}`);
      }

      payload = (await response.json()) as ReoonResponse;
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'request timed out' : err?.message;
      logger.warn(`Reoon verification failed for ${email}: ${reason}`);
      return skipped(`provider unreachable: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (payload.error || payload.message) {
      const detail = payload.error || payload.message;
      logger.warn(`Reoon error for ${email}: ${detail}`);
      return skipped(`provider error: ${detail}`);
    }

    const status = payload.status ?? null;
    const score = typeof payload.overall_score === 'number' ? payload.overall_score : null;

    // Score is the primary signal. If Reoon omitted it, fall back to its own verdict.
    const verified =
      score !== null ? score >= config.emailVerification.minScore : status === 'valid';

    logger.info(
      `Email verification for ${email}: status=${status} score=${score} -> ${verified ? 'verified' : 'not verified'}`
    );

    return { verified, score, status, skippedReason: null };
  }
}

export const emailVerificationService = new EmailVerificationService();
