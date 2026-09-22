import Stripe from 'stripe';
import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { stripe } from '../config/stripe.config.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { BoostProfile } from '../entities/BoostProfile.entity.js';
import { SUBSCRIPTION_INTERVAL_DAYS } from '../constants/pricing.constants.js';
import { ms } from '../utils/boost-date.util.js';
import { BoostError } from '../utils/boost-response.util.js';
import { logger } from '../utils/logger.util.js';
import { readSubscriptionPeriod } from '../utils/stripe-period.util.js';
import type { SubscriptionDto } from '../types/boost.types.js';

const subscriptionRepo = () => AppDataSource.getRepository(CustomerSubscription);

/**
 * The membership, as the members' area sees it.
 *
 * Reads the funnel's own `customer_subscriptions` — there is no second
 * subscription record. Stripe remains the source of truth for money; this maps
 * what the funnel already stores into the shape the subscription screen renders.
 */

/**
 * The states that grant access to training.
 *
 * `past_due` is deliberately included: a failed renewal is usually an expired
 * card, and locking someone out of the streak they have been building for four
 * months over a retryable payment is how you turn a billing hiccup into a
 * cancellation. `canceled` is the only state that stops training, and even then
 * the member keeps read-only access to their history.
 */
const ACCESS_STATES = new Set(['active', 'trialing', 'past_due']);

export const hasTrainingAccess = (sub: CustomerSubscription | null): boolean =>
  Boolean(sub) && ACCESS_STATES.has(sub!.status);

/** The member's current subscription — the newest, if they have bought more than once. */
export async function findSubscription(customerId: string): Promise<CustomerSubscription | null> {
  return AppDataSource.getRepository(CustomerSubscription).findOne({
    where: { customer_id: customerId },
    order: { created_at: 'DESC' }
  });
}

/**
 * Money as a member should read it.
 *
 * JPY is zero-decimal — `¥980`, never `¥980.00`. Everything else gets two
 * places. `Intl` knows this per currency, so the rule is not hardcoded here.
 */
export function formatMoney(amount: string | number, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';

  try {
    return new Intl.NumberFormat(currency === 'JPY' ? 'ja-JP' : 'en-GB', {
      style: 'currency',
      currency
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

/** What the programme is called to customers, in one place. */
const PROGRAM_NAME = 'myIQ Cognitive Training Program';

/**
 * Stored plan name -> what the member is shown.
 *
 * The keys are lowercased plan names as they were written at the time of the
 * sale, and the old ones stay here permanently. A subscription billed before
 * the programme was renamed still carries `IQ Brain Training` in the database,
 * and its receipts should show what the programme is called now — not the name
 * it happened to have the day that row was inserted.
 */
const PLAN_LABELS: Record<string, string> = {
  premium: 'Premium',
  subscription: 'Premium',
  // Current, in both languages the funnel sells in.
  'myiq cognitive training program': PROGRAM_NAME,
  'myiq認知トレーニングプログラム': PROGRAM_NAME,
  // Legacy. `IQ Training Monthly` is the oldest and the one that matters most
  // to catch: left as-is it tells a member their plan is monthly, when it has
  // billed every 28 days since SUBSCRIPTION_INTERVAL_DAYS was introduced.
  'iq brain training': PROGRAM_NAME,
  'iq脳力トレーニング': PROGRAM_NAME,
  'iq training monthly': PROGRAM_NAME,
  // What BRAIN_TRAINING_NAME defaulted to before the rename, so anything sold
  // while that default was live still reads as the current name.
  'brain training program': PROGRAM_NAME,
  '脳力トレーニングプログラム': PROGRAM_NAME
};

const planLabelFor = (planName: string | null): string => {
  if (!planName) return 'Premium';
  return PLAN_LABELS[planName.toLowerCase()] ?? planName;
};

/** Human labels for the transaction types the funnel records. */
const INVOICE_LABELS: Record<string, string> = {
  first_sale: 'Cognitive assessment certificate',
  cross_sale: 'Career and aptitude report',
  // Not "monthly": the cycle is 28 days, so a receipt saying monthly would not
  // match the dates on the customer's statement.
  subscription: `${PROGRAM_NAME} membership`,
  refund: 'Refund'
};

/**
 * The full subscription payload, including the certificate the member bought
 * and their receipts.
 *
 * The certificate is not stored twice: it is the customer's newest quiz result,
 * which is where the IQ score and its issue date already live.
 */
export async function toSubscriptionDto(
  customerId: string,
  subscription: CustomerSubscription | null
): Promise<SubscriptionDto | null> {
  if (!subscription) return null;

  // Subscriptions that predate the cached card columns fill them on first read.
  await ensureCardCached(subscription);

  const [quizResult, transactions, profile] = await Promise.all([
    AppDataSource.getRepository(CustomerQuizResult).findOne({
      where: { customer_id: customerId },
      order: { created_at: 'DESC' }
    }),
    AppDataSource.getRepository(CustomerQuizResultPaymentTransaction).find({
      where: { customer_id: customerId, status: 'succeeded' },
      order: { created_at: 'DESC' },
      take: 24
    }),
    AppDataSource.getRepository(BoostProfile).findOne({ where: { customer_id: customerId } })
  ]);

  const certificate =
    quizResult && quizResult.iq_score !== null
      ? {
          id: profile?.member_id ?? `MIQ-${quizResult.id}`,
          iq: quizResult.iq_score,
          issuedAt: quizResult.created_at.getTime()
        }
      : null;

  const paymentMethod = subscription.card_brand
    ? {
        brand: subscription.card_brand,
        last4: subscription.card_last4 ?? '',
        expMonth: subscription.card_exp_month,
        expYear: subscription.card_exp_year
      }
    : null;

  return {
    id: `sub_${subscription.id}`,
    userId: customerId,
    status: subscription.status,
    plan: subscription.plan_name ?? 'premium',
    planLabel: planLabelFor(subscription.plan_name),
    priceLabel: formatMoney(subscription.amount, subscription.currency),
    startedAt: ms(subscription.current_period_start) ?? subscription.created_at.getTime(),
    currentPeriodEnd: ms(subscription.current_period_end),
    canceledAt: ms(subscription.canceled_at),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    intervalDays: SUBSCRIPTION_INTERVAL_DAYS,
    // Stripe reports `trialing` until the first charge, and `current_period_end`
    // is the trial end for as long as it does.
    trialEndsAt:
      subscription.status === 'trialing' ? ms(subscription.current_period_end) : null,
    paymentMethod,
    certificate,
    invoices: transactions.map((tx) => ({
      id: `in_${tx.id}`,
      date: tx.created_at.getTime(),
      label: INVOICE_LABELS[tx.transaction_type] ?? tx.transaction_type,
      amount: formatMoney(tx.amount, tx.currency)
    }))
  };
}

/* ── managing the subscription from the members' area ─────────────────────── */

/**
 * The member's subscription, or a failure the UI can render.
 *
 * Every action below needs the same three things — the row, a Stripe id on it,
 * and a readable error when either is missing — so they are resolved once here.
 */
async function requireStripeSubscription(customerId: string): Promise<CustomerSubscription> {
  const subscription = await findSubscription(customerId);

  if (!subscription) {
    throw new BoostError(404, 'no_subscription', 'No subscription found for this account.');
  }

  if (!subscription.stripe_subscription_id) {
    // A row written before the Stripe subscription existed, or created by hand.
    // Nothing here works without a payment provider behind it.
    throw new BoostError(
      409,
      'subscription_not_manageable',
      'This membership cannot be changed online. Please contact support.'
    );
  }

  return subscription;
}

/**
 * Copies Stripe's answer onto our row.
 *
 * Each action below changes state at Stripe, and the webhook that normally keeps
 * us in step can lag by seconds. Writing what Stripe just returned means the
 * response the member sees is already right, and the webhook arriving later is a
 * no-op rather than a correction.
 */
async function applyStripeState(
  record: CustomerSubscription,
  subscription: Stripe.Subscription
): Promise<CustomerSubscription> {
  // Read through the helper rather than off the subscription: Stripe moved the
  // period onto the items in Basil, and this row is the one the subscription
  // screen prints "renews on" from.
  const { start: periodStart, end: periodEnd } = readSubscriptionPeriod(subscription);

  record.status = subscription.status;
  record.cancel_at_period_end = Boolean(subscription.cancel_at_period_end);
  if (periodStart) record.current_period_start = periodStart;
  if (periodEnd) record.current_period_end = periodEnd;

  // When it actually ended, not when it was asked to end.
  //
  // Stripe's own `canceled_at` is the moment cancellation was *requested*, so
  // it is set the instant `cancel_at_period_end` is flipped — a month before
  // access stops. Copying it straight across would have the subscription screen
  // print "Ended on" against a membership the member is still using, so this
  // only fills once Stripe reports the subscription as actually over.
  const ended = subscription.status === 'canceled';
  const endedAt = (subscription as any).ended_at ?? subscription.canceled_at;
  record.canceled_at = ended && endedAt ? new Date(endedAt * 1000) : null;

  await readCardInto(record, subscription);

  return subscriptionRepo().save(record);
}

/**
 * Reads the card behind a subscription into the cached columns.
 *
 * The subscription's own default payment method first, then the customer's —
 * the billing portal usually updates the latter, and a member who has just
 * changed their card should not be shown the old one on their way back.
 */
async function readCardInto(
  record: CustomerSubscription,
  subscription?: Stripe.Subscription
): Promise<void> {
  try {
    let paymentMethodId: string | null = null;

    const onSubscription = subscription?.default_payment_method;
    if (onSubscription) {
      paymentMethodId = typeof onSubscription === 'string' ? onSubscription : onSubscription.id;
    }

    if (!paymentMethodId && record.stripe_customer_id) {
      const customer = await stripe.customers.retrieve(record.stripe_customer_id);
      if (!('deleted' in customer)) {
        const fallback = customer.invoice_settings?.default_payment_method;
        if (fallback) paymentMethodId = typeof fallback === 'string' ? fallback : fallback.id;
      }
    }

    if (!paymentMethodId) return;

    const method = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (!method.card) return;

    record.card_brand = method.card.brand ? method.card.brand.toUpperCase() : null;
    record.card_last4 = method.card.last4 ?? null;
    record.card_exp_month = method.card.exp_month ?? null;
    record.card_exp_year = method.card.exp_year ?? null;
  } catch (error: any) {
    // The card is a nicety on a settings screen. Failing to read it must not
    // fail the cancel or resume the member actually asked for.
    logger.warn(`Could not read the card for subscription ${record.id}: ${error?.message ?? error}`);
  }
}

/**
 * Stops the subscription renewing, without taking away time already paid for.
 *
 * `cancel_at_period_end` rather than an immediate cancellation: the member has
 * paid through to `current_period_end`, and ending it the moment they click
 * takes that from them and turns a cancellation into a refund request. Until
 * that date they keep full access, and `resumeSubscription` un-cancels with no
 * new charge.
 */
export async function cancelSubscription(customerId: string): Promise<CustomerSubscription> {
  const record = await requireStripeSubscription(customerId);

  if (record.status === 'canceled') {
    throw new BoostError(409, 'already_canceled', 'This membership has already ended.');
  }

  try {
    const updated = await stripe.subscriptions.update(record.stripe_subscription_id, {
      cancel_at_period_end: true
    });
    return await applyStripeState(record, updated);
  } catch (error: any) {
    logger.error(`Stripe cancel failed for subscription ${record.id}: ${error?.message ?? error}`);
    throw new BoostError(
      502,
      'billing_unavailable',
      'We could not reach the payment provider. Please try again in a moment.'
    );
  }
}

/**
 * Un-cancels a subscription that is still inside its paid period.
 *
 * Only possible while Stripe still has it open. Once the period has actually
 * elapsed the subscription is gone, and restarting means buying again — a
 * funnel purchase, not something this endpoint can do.
 */
export async function resumeSubscription(customerId: string): Promise<CustomerSubscription> {
  const record = await requireStripeSubscription(customerId);

  if (record.status === 'canceled') {
    throw new BoostError(
      409,
      'subscription_ended',
      'This membership has already ended. Start a new one to pick up where you left off.'
    );
  }

  // Already running. Return the current state rather than an error: the member
  // wanted it active, and it is.
  if (!record.cancel_at_period_end) return record;

  try {
    const updated = await stripe.subscriptions.update(record.stripe_subscription_id, {
      cancel_at_period_end: false
    });
    return await applyStripeState(record, updated);
  } catch (error: any) {
    logger.error(`Stripe resume failed for subscription ${record.id}: ${error?.message ?? error}`);
    throw new BoostError(
      502,
      'billing_unavailable',
      'We could not reach the payment provider. Please try again in a moment.'
    );
  }
}

/**
 * A one-time link to Stripe's hosted billing portal.
 *
 * Card details never reach this service or the members' bundle, which keeps the
 * entire PCI surface at Stripe and means 3-D Secure, expiring cards and failed
 * retries are handled by code that is not ours.
 *
 * Single-member by construction: the session is created against the Stripe
 * customer id on the caller's own row, so a link cannot be minted for anyone
 * else.
 */
export async function createBillingPortalSession(customerId: string): Promise<string> {
  const record = await requireStripeSubscription(customerId);

  if (!record.stripe_customer_id) {
    throw new BoostError(
      409,
      'subscription_not_manageable',
      'This membership has no billing account attached. Please contact support.'
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: record.stripe_customer_id,
      return_url: `${config.boost.appUrl.replace(/\/+$/, '')}/app/subscription`
    });

    return session.url;
  } catch (error: any) {
    logger.error(`Stripe billing portal failed for subscription ${record.id}: ${error?.message ?? error}`);

    // The portal has to be switched on once in the Stripe dashboard, and until
    // it is every call fails this way. Worth naming rather than leaving someone
    // to guess from a generic billing error.
    if (typeof error?.message === 'string' && error.message.toLowerCase().includes('configuration')) {
      logger.error(
        'The Stripe billing portal has no default configuration. Enable it once at ' +
          'https://dashboard.stripe.com/settings/billing/portal'
      );
    }

    throw new BoostError(
      502,
      'billing_unavailable',
      'We could not open the billing page. Please try again in a moment.'
    );
  }
}

/**
 * Fills the cached card columns when they are empty.
 *
 * Covers subscriptions that predate those columns, and any card change that
 * arrived without a webhook we listen for. Cheap, because it only calls Stripe
 * when there is nothing to show.
 */
export async function ensureCardCached(record: CustomerSubscription): Promise<CustomerSubscription> {
  if (record.card_last4 || !record.stripe_customer_id) return record;

  await readCardInto(record);

  return record.card_last4 ? subscriptionRepo().save(record) : record;
}
