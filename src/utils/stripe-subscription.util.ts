import type Stripe from 'stripe';
import type { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { readSubscriptionPeriod } from './stripe-period.util.js';

/**
 * Stripe's view of a subscription, copied onto our row.
 *
 * The one mapping every write path goes through — the webhook, the first sale,
 * the members' cancel and resume, and the resync script — so that whichever of
 * them lands last, the row says the same thing Stripe does.
 *
 * Cancelling does not change `status`. A member who cancels during the trial is
 * still `trialing` at Stripe until the trial runs out, and a paid member stays
 * `active` until the period does; only then does Stripe end the subscription
 * and report `canceled`. What changes at the moment of cancelling is the
 * schedule, and Stripe has three ways of writing it down:
 *
 * - **At period end** (our members' area, the billing portal): `cancel_at_period_end`
 *   is true and `cancel_at` is the period end.
 * - **On a custom date** (the Dashboard's "on a custom day", or the API):
 *   `cancel_at_period_end` stays *false* and only `cancel_at` is set.
 * - **Flexible billing mode** resolves "at period end" straight into `cancel_at`,
 *   again leaving `cancel_at_period_end` false.
 *
 * So `cancel_at` is the field that is set in every case, and reading only
 * `cancel_at_period_end` reports a custom-date cancellation as a renewal.
 *
 * Stripe's `canceled_at` is also not what its name suggests: it is the moment the
 * cancellation was *requested*, set the instant any of the above is scheduled.
 * The moment the subscription actually stopped is `ended_at`.
 */
export function applyStripeSubscription(
  record: CustomerSubscription,
  subscription: Stripe.Subscription
): void {
  // Read through the helper rather than off the subscription: Stripe moved the
  // period onto the items in Basil. See `readSubscriptionPeriod`.
  const { start: periodStart, end: periodEnd } = readSubscriptionPeriod(subscription);

  record.status = subscription.status;
  if (periodStart) record.current_period_start = periodStart;
  if (periodEnd) record.current_period_end = periodEnd;

  record.cancel_at_period_end = Boolean(subscription.cancel_at_period_end);
  record.cancel_at = toDate(subscription.cancel_at);
  record.cancel_requested_at = toDate(subscription.canceled_at);
  // `cancellation_requested`, `payment_failed` or `payment_disputed`. Cleared by
  // Stripe when a cancellation is withdrawn, and cleared here with it.
  record.cancel_reason = subscription.cancellation_details?.reason ?? null;

  // When it actually ended, never when it was asked to end. Filling this from
  // Stripe's `canceled_at` would date the end of a membership the member is
  // still using.
  const endedAt = toDate((subscription as any).ended_at);
  record.canceled_at =
    endedAt ?? (subscription.status === 'canceled' ? toDate(subscription.canceled_at) : null);
}

type CancellationFields = Pick<
  CustomerSubscription,
  'status' | 'cancel_at_period_end' | 'cancel_at' | 'current_period_end'
>;

/**
 * True when the subscription is set to end but has not ended yet — however the
 * cancellation was made. The renewal is off; access is not.
 */
export function isCancellationScheduled(record: CancellationFields): boolean {
  return scheduledCancelAt(record) !== null;
}

/**
 * The date a scheduled cancellation takes effect, or null when none is pending.
 *
 * `cancel_at` covers every way Stripe schedules an end. The period end is only a
 * fallback for rows written before `cancel_at` was stored, which only knew about
 * `cancel_at_period_end` — and for those the two dates are the same.
 */
export function scheduledCancelAt(record: CancellationFields): Date | null {
  if (record.status === 'canceled' || record.status === 'incomplete_expired') {
    return null;
  }
  return record.cancel_at ?? (record.cancel_at_period_end ? record.current_period_end : null);
}

const toDate = (seconds: unknown): Date | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
