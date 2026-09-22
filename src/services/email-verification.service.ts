import { config } from '../config/env.config.js';
import {
  externalApiLogService,
  redactUrl,
  EXTERNAL_API_SERVICE
} from './external-api-log.service.js';
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

    // The key rides in the query string, so the stored endpoint must be the
    // masked form — never `url` itself.
    const endpoint = redactUrl(url);
    const requestPayload = { email, mode: config.emailVerification.mode };
    const startedAt = Date.now();

    let payload: ReoonResponse;
    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        await externalApiLogService.log({
          service_name: EXTERNAL_API_SERVICE.REOON,
          endpoint,
          method: 'GET',
          status_code: response.status,
          request_payload: requestPayload,
          is_error: true,
          error_message: `Provider returned HTTP ${response.status}`,
          duration_ms: Date.now() - startedAt
        });

        logger.warn(`Reoon returned HTTP ${response.status} for ${email}`);
        return skipped(`provider returned HTTP ${response.status}`);
      }

      payload = (await response.json()) as ReoonResponse;

      // A 200 body can still be a refusal (`error`/`message`), so `is_error`
      // here is the transport verdict; the check below overwrites nothing and
      // instead records the provider's own complaint as a second row would be
      // noise — it is folded into this one via the payload.
      await externalApiLogService.log({
        service_name: EXTERNAL_API_SERVICE.REOON,
        endpoint,
        method: 'GET',
        status_code: response.status,
        request_payload: requestPayload,
        response_payload: payload,
        is_error: Boolean(payload.error || payload.message),
        error_message: (payload.error || payload.message) ?? undefined,
        duration_ms: Date.now() - startedAt
      });
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'request timed out' : err?.message;

      await externalApiLogService.log({
        service_name: EXTERNAL_API_SERVICE.REOON,
        endpoint,
        method: 'GET',
        request_payload: requestPayload,
        is_error: true,
        error_message: `Provider unreachable: ${reason}`,
        duration_ms: Date.now() - startedAt
      });

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
