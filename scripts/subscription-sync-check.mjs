/**
 * Our subscription row against Stripe, through every way a cancellation is made.
 *
 *   npm run test:subscription-sync      (no server needed)
 *
 * Creates a real Stripe test-mode subscription on a trial and a throwaway
 * customer row, then changes the subscription the ways Stripe allows — from
 * the members' area, on a custom date the way the Dashboard does it, and
 * immediately — and checks after each that the row says what Stripe says.
 *
 * Webhooks are delivered through the real handler with a valid signature, in
 * the newer API version Stripe sends them in, and some are deliberately stale:
 * Stripe does not deliver events in order, and an old payload landing last must
 * not rewind the row.
 *
 * Cleans up after itself: the Stripe customer (and with it the subscription)
 * and the customer row (and with it the subscription row) are deleted.
 */
import 'reflect-metadata';
import Stripe from 'stripe';
import dotenv from 'dotenv';

// Before the config is read: the SQL log would bury the results.
process.env.DB_LOGGING = 'false';
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this test writes to the database and NODE_ENV is production.');
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) {
  console.error('\nThis test needs a Stripe TEST secret key in STRIPE_SECRET_KEY. Refusing to run.\n');
  process.exit(1);
}

const priceId = process.env.STRIPE_SUB_PRICE_ID_JA;
if (!priceId) {
  console.error('\nSTRIPE_SUB_PRICE_ID_JA is not set — run `npm run check:pricing` first.\n');
  process.exit(1);
}

const { AppDataSource } = await import('../src/config/database.config.ts');
const { config } = await import('../src/config/env.config.ts');
const { stripe } = await import('../src/config/stripe.config.ts');
const { CustomerSubscription } = await import('../src/entities/CustomerSubscription.entity.ts');
const { paymentService } = await import('../src/services/payment.service.ts');
const boost = await import('../src/services/boost-subscription.service.ts');
const { scheduledCancelAt } = await import('../src/utils/stripe-subscription.util.ts');

// Webhooks arrive in the account's API version, not the SDK's pinned one — and
// in that version the period is gone from the subscription itself.
const WEBHOOK_API_VERSION = '2026-07-29.dahlia';
const asWebhook = new Stripe(key, { apiVersion: WEBHOOK_API_VERSION });

const EMAIL = 'subscription.sync.probe@example.com';

let pass = 0, fail = 0;
const check = (n, c, d = '') => {
  c ? pass++ : fail++;
  console.log((c ? '  PASS  ' : '  FAIL  ') + n + (!c && d ? ' :: ' + d : ''));
};
const at = (seconds) => (seconds ? seconds * 1000 : null);
const time = (date) => (date ? date.getTime() : null);

await AppDataSource.initialize();
const repo = AppDataSource.getRepository(CustomerSubscription);

// A run that died half way leaves its customer behind.
await AppDataSource.query('DELETE FROM customers WHERE email = $1', [EMAIL]);

const stripeCustomer = await stripe.customers.create({
  email: EMAIL,
  description: 'Automated test — safe to delete'
});

let CID = null;

try {
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomer.id });
  await stripe.customers.update(stripeCustomer.id, {
    invoice_settings: { default_payment_method: pm.id }
  });

  [{ id: CID }] = await AppDataSource.query(
    `INSERT INTO customers (email, status, stripe_customer_id) VALUES ($1, 'active', $2) RETURNING id`,
    [EMAIL, stripeCustomer.id]
  );

  /** Through the real handler, signed with this environment's secret. */
  const deliver = async (type, object) => {
    const payload = JSON.stringify({
      id: 'evt_probe_' + Date.now() + Math.random().toString(36).slice(2, 8),
      object: 'event',
      type,
      api_version: WEBHOOK_API_VERSION,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object }
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: config.stripe.webhookSecret
    });
    await paymentService.handleWebhook(Buffer.from(payload), signature);
  };

  // Created the way the funnel creates it: through our pinned client, on a trial.
  const sub = await stripe.subscriptions.create({
    customer: stripeCustomer.id,
    items: [{ price: priceId }],
    default_payment_method: pm.id,
    off_session: true,
    payment_behavior: 'allow_incomplete',
    trial_period_days: 5
  });
  const row = () => repo.findOne({ where: { stripe_subscription_id: sub.id } });
  const live = () => asWebhook.subscriptions.retrieve(sub.id);

  console.log('\n--- A new trial');
  const created = await live();
  await deliver('customer.subscription.created', created);
  let r = await row();
  check('the webhook opens the row', Boolean(r));
  check('status is trialing', r?.status === 'trialing', r?.status);
  check('the period is the trial', time(r?.current_period_end) === at(created.trial_end));
  check('nothing is scheduled', r?.cancel_at === null && scheduledCancelAt(r) === null);

  console.log('\n--- Cancelled from the members\' area during the trial');
  await boost.cancelSubscription(CID);
  r = await row();
  let s = await live();
  check('Stripe keeps it trialing until the trial ends', s.status === 'trialing', s.status);
  check('status stays trialing — mirrors Stripe', r.status === 'trialing', r.status);
  check('cancel_at_period_end is set', r.cancel_at_period_end === true);
  check('cancel_at is the trial end', time(r.cancel_at) === at(s.cancel_at) && s.cancel_at === s.trial_end);
  check('the request time is kept', time(r.cancel_requested_at) === at(s.canceled_at));
  check('it has not ended', r.canceled_at === null);
  check('the reason is Stripe\'s', r.cancel_reason === 'cancellation_requested', r.cancel_reason);
  let dto = await boost.toSubscriptionDto(CID, r);
  check('members\' area: shown as cancelling', dto.cancelAtPeriodEnd === true);
  check('members\' area: access until the trial end', dto.cancelAt === at(s.trial_end));

  console.log('\n--- A stale event from before the cancellation arrives last');
  await deliver('customer.subscription.updated', created);
  r = await row();
  check('the cancellation survives it', r.cancel_at_period_end === true && r.cancel_at !== null);

  console.log('\n--- Cancelling twice');
  await boost.cancelSubscription(CID);
  r = await row();
  check('still scheduled, nothing changed', time(r.cancel_at) === at(s.cancel_at));

  console.log('\n--- Resumed from the members\' area');
  await boost.resumeSubscription(CID);
  r = await row();
  s = await live();
  check('Stripe: renewing again', s.cancel_at === null && s.cancel_at_period_end === false);
  check('row: renewing again', r.cancel_at === null && r.cancel_at_period_end === false);
  check('the request time and reason are cleared', r.cancel_requested_at === null && r.cancel_reason === null);

  console.log('\n--- Cancelled in the Dashboard on a custom date, inside the trial');
  const in3Days = Math.floor(Date.now() / 1000) + 3 * 86400;
  await stripe.subscriptions.update(sub.id, { cancel_at: in3Days, proration_behavior: 'none' });
  await deliver('customer.subscription.updated', await live());
  r = await row();
  s = await live();
  check('Stripe leaves cancel_at_period_end false', s.cancel_at_period_end === false);
  check('row: cancel_at is the custom date', time(r.cancel_at) === in3Days * 1000);
  check('row: the period was shortened with it', time(r.current_period_end) === at(s.items.data[0].current_period_end));
  dto = await boost.toSubscriptionDto(CID, r);
  check('members\' area: shown as cancelling despite the flag', dto.cancelAtPeriodEnd === true);

  console.log('\n--- Resuming a custom-date cancellation');
  await boost.resumeSubscription(CID);
  s = await live();
  r = await row();
  check('Stripe: custom date cleared', s.cancel_at === null, String(s.cancel_at));
  check('row: custom date cleared', r.cancel_at === null);

  console.log('\n--- A custom date after the current period');
  const in40Days = Math.floor(Date.now() / 1000) + 40 * 86400;
  await stripe.subscriptions.update(sub.id, { cancel_at: in40Days });
  await deliver('customer.subscription.updated', await live());
  r = await row();
  check('row: cancel_at is 40 days out', time(r.cancel_at) === in40Days * 1000);
  check('row: the period is untouched', time(r.cancel_at) !== time(r.current_period_end));
  dto = await boost.toSubscriptionDto(CID, r);
  check('members\' area: access until the custom date, not the period end', dto.cancelAt === in40Days * 1000);
  await boost.cancelSubscription(CID);
  s = await live();
  check('cancelling again does not pull the date forward', s.cancel_at === in40Days, String(s.cancel_at));

  console.log('\n--- Cancelled immediately');
  const beforeEnd = await live();
  await stripe.subscriptions.cancel(sub.id);
  const ended = await live();
  await deliver('customer.subscription.deleted', ended);
  r = await row();
  check('status is canceled', r.status === 'canceled', r.status);
  check('canceled_at is when Stripe ended it', time(r.canceled_at) === at(ended.ended_at));
  check('nothing is scheduled any more', scheduledCancelAt(r) === null);
  check('the reason is kept', r.cancel_reason === 'cancellation_requested', r.cancel_reason);
  dto = await boost.toSubscriptionDto(CID, r);
  check('members\' area: ended, not cancelling', dto.status === 'canceled' && dto.cancelAtPeriodEnd === false);

  console.log('\n--- Stale events after the end');
  await deliver('customer.subscription.updated', beforeEnd);
  r = await row();
  check('a stale webhook does not revive it', r.status === 'canceled', r.status);
  // The fallback path, when Stripe cannot be re-read: the payload is all there is.
  await paymentService['upsertSubscriptionRecord'](beforeEnd, CID, null);
  r = await row();
  check('nor does a stale payload written directly', r.status === 'canceled', r.status);
} catch (error) {
  fail++;
  console.error('\nAborted:', error?.message ?? error);
} finally {
  await stripe.customers.del(stripeCustomer.id).catch(() => {});
  if (CID) await AppDataSource.query('DELETE FROM customers WHERE id = $1', [CID]);
  await AppDataSource.destroy();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
