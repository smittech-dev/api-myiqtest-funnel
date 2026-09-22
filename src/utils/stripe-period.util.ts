import type Stripe from 'stripe';

/**
 * The billing period of a Stripe subscription, wherever Stripe decided to put it.
 *
 * `current_period_start` / `current_period_end` used to live on the Subscription
 * itself. From API version 2025-03-31 (Basil) they live on each subscription
 * *item* instead, and the fields on the Subscription are gone.
 *
 * That split is invisible until a webhook arrives. Our SDK calls are pinned to
 * an older version and keep returning the old shape, but Stripe delivers webhook
 * events in the *account's* default API version — so the moment the account is
 * upgraded, `subscription.current_period_end` on an incoming
 * `customer.subscription.updated` is `undefined`. The period columns then simply
 * stop being written: the trial's dates stay in the database for ever while the
 * subscription quietly renews at Stripe. That is the bug this exists to close.
 *
 * Reads both shapes and returns whichever is present, so neither an upgrade nor
 * a rollback of the account's API version can strand the dates again.
 */
export interface SubscriptionPeriod {
  start: Date | null;
  end: Date | null;
}

const toDate = (seconds: unknown): Date | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;

export function readSubscriptionPeriod(subscription: Stripe.Subscription): SubscriptionPeriod {
  const raw = subscription as any;

  // Pre-Basil: on the subscription.
  const start = toDate(raw.current_period_start);
  const end = toDate(raw.current_period_end);

  if (start || end) {
    return { start, end };
  }

  // Basil and later: on the items. A subscription can in principle hold items on
  // different cycles; ours never does, so the widest span across them is both
  // correct for us and the sanest reading of a case we do not sell.
  const items: any[] = raw.items?.data ?? [];
  let itemStart: Date | null = null;
  let itemEnd: Date | null = null;

  for (const item of items) {
    const s = toDate(item?.current_period_start);
    const e = toDate(item?.current_period_end);
    if (s && (!itemStart || s < itemStart)) itemStart = s;
    if (e && (!itemEnd || e > itemEnd)) itemEnd = e;
  }

  return { start: itemStart, end: itemEnd };
}
