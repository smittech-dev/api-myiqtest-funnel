import { AppDataSource } from '../config/database.config.js';
import { ExternalApiLog } from '../entities/ExternalApiLog.entity.js';
import { logger } from '../utils/logger.util.js';

/**
 * The `service_name` values this table recognises.
 *
 * Incoming traffic gets its own name rather than a shared one with a direction
 * flag: `service_name` is the indexed column, so `stripe` vs `stripe_webhook`
 * separates a call we made from a call made to us without a schema change and
 * without a second predicate on every query.
 */
export const EXTERNAL_API_SERVICE = {
  ZEPTOMAIL: 'zeptomail',
  REOON: 'reoon',
  EXCHANGE_RATES: 'exchange_rates',
  STRIPE: 'stripe',
  STRIPE_WEBHOOK: 'stripe_webhook'
} as const;

/** `endpoint` is VARCHAR(255) — a longer value aborts the insert. */
const ENDPOINT_MAX = 255;

/**
 * Ceiling on one jsonb column. A Stripe invoice event with many line items, or
 * a full exchange-rate table, runs to tens of KB; without a cap a single busy
 * day of those outgrows every other table in the database.
 */
const PAYLOAD_MAX_CHARS = 20_000;

/** Kept when a payload is truncated — enough to identify it, not to replay it. */
const PAYLOAD_PREVIEW_CHARS = 2_000;

/**
 * Query parameters that carry a credential.
 *
 * Reoon and the exchange-rate provider are both GET APIs that take their API
 * key in the URL, so storing the URL as-is would put a live key in a table that
 * exists to be read during debugging.
 */
const SECRET_QUERY_PARAMS = ['key', 'api_key', 'apikey', 'access_key', 'token', 'secret'];

/** The URL with any credential query parameter masked. */
export function redactUrl(raw: string | URL): string {
  try {
    const url = new URL(String(raw));
    for (const param of SECRET_QUERY_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, '***');
      }
    }
    return url.toString();
  } catch {
    // Not an absolute URL (a Stripe SDK path, say) — nothing to redact.
    return String(raw);
  }
}

export class ExternalApiLogService {
  private logRepository = AppDataSource.getRepository(ExternalApiLog);

  async log(params: {
    service_name: string;
    endpoint: string;
    method: string;
    status_code?: number;
    request_payload?: any;
    response_payload?: any;
    is_error?: boolean;
    error_message?: string;
    duration_ms?: number;
  }): Promise<void> {
    try {
      const logEntry = this.logRepository.create({
        service_name: params.service_name,
        endpoint: params.endpoint.slice(0, ENDPOINT_MAX),
        method: params.method,
        status_code: params.status_code ?? null,
        request_payload: this.cap(params.request_payload),
        response_payload: this.cap(params.response_payload),
        is_error: params.is_error ?? false,
        error_message: params.error_message ?? null,
        duration_ms: params.duration_ms ?? null
      });

      await this.logRepository.save(logEntry);
    } catch (err) {
      // Don't let logging failures crash the request
      logger.error('Failed to write external API log:', err);
    }
  }

  /**
   * A value safe to hand to a jsonb column: an object, bounded in size.
   *
   * Callers redact their own secrets (they know which field is which); this is
   * the size backstop that applies whether or not they remembered to trim.
   */
  private cap(value: any): Record<string, any> | null {
    if (value === undefined || value === null) {
      return null;
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      // Circular reference, BigInt, etc. Losing the body beats losing the row.
      return { _unserializable: true };
    }

    if (serialized.length > PAYLOAD_MAX_CHARS) {
      return {
        _truncated: true,
        _chars: serialized.length,
        preview: serialized.slice(0, PAYLOAD_PREVIEW_CHARS)
      };
    }

    // jsonb takes a scalar happily, but every reader expects an object.
    return typeof value === 'object' ? value : { value };
  }
}

export const externalApiLogService = new ExternalApiLogService();
