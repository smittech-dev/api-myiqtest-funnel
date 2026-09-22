import Stripe from 'stripe';
import { config } from './env.config.js';
import { externalApiLogService, EXTERNAL_API_SERVICE } from '../services/external-api-log.service.js';

/**
 * The one Stripe client.
 *
 * There used to be three, constructed independently in the payment, boost
 * subscription and email-change services — each with the same key and the same
 * pinned API version, which is what `boost-subscription` meant by "so both see
 * one Stripe". Three clients also meant three connection pools, three sets of
 * SDK retries, and a listener attached to any one of them seeing a third of the
 * traffic. Everything imports this instead.
 *
 * The API version stays pinned here and nowhere else: a version drift between
 * two clients would have them disagree about the shape of a subscription's
 * billing period, which is precisely the field the renewal ledger is built on.
 */
export const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2025-02-24.acacia' as any
});

/**
 * Records every outgoing Stripe call in `external_api_logs`.
 *
 * The SDK emits `response` for each completed round trip, which is why this is
 * one listener rather than a wrapper at each of the ~20 call sites: a call added
 * later cannot silently escape the log, and no payment path pays for a helper in
 * its hot line.
 *
 * What it cannot see is a connection that never completed — the SDK emits no
 * event for that, and by then it has exhausted its own retries and thrown, so
 * the failure surfaces as an application error instead. A Stripe *rejection*
 * (402 on a decline, 400 on a bad request) is a completed round trip and is
 * captured here like any other.
 *
 * Bodies are not on this event, and are not wanted: they would carry customer
 * PII into a table that exists to be read during debugging, while `request_id` —
 * the thing Stripe support actually asks for — is right here.
 */
stripe.on('response', (response) => {
  const isError = response.status >= 400;

  // Not awaited: this fires from the SDK's emitter, which has nobody to wait for
  // it. `log()` swallows its own failures, so it never rejects.
  void externalApiLogService.log({
    service_name: EXTERNAL_API_SERVICE.STRIPE,
    endpoint: response.path ?? 'unknown',
    method: (response.method ?? 'UNKNOWN').toUpperCase(),
    status_code: response.status,
    response_payload: {
      request_id: response.request_id ?? null,
      idempotency_key: response.idempotency_key ?? null,
      api_version: response.api_version ?? null
    },
    is_error: isError,
    error_message: isError
      ? `Stripe returned HTTP ${response.status} (request_id: ${response.request_id ?? 'n/a'})`
      : undefined,
    duration_ms: response.elapsed ?? undefined
  });
});
