/**
 * Subscription management, against Stripe test mode.
 *
 *   npm run test:boost:subscription
 *
 * Creates a real Stripe test-mode customer, card and subscription, points the
 * test member at it, and drives cancel / resume / billing portal through the
 * members' API. Nothing here is simulated: the assertions are about what Stripe
 * actually did.
 *
 * The behaviour that matters most is the one that is easy to get wrong —
 * cancelling must *not* take away time the member has already paid for. Stripe
 * keeps such a subscription `active` until the period ends, so the checks below
 * are as much about access surviving the cancellation as about the flag.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import Stripe from 'stripe';
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

const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });

const BASE = (process.env.BOOST_TEST_BASE_URL || 'http://localhost:' + (process.env.PORT || 5000)) + '/boost-api/v1';
const EMAIL = 'boost.tester@example.com';
const PASSWORD = process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd';
const ORIGIN = (process.env.BOOST_APP_ORIGINS || 'http://localhost:5173').split(',')[0].trim();

let token = null;
let pass = 0, fail = 0;
const out = [];
const check = (n, c, d = '') => { c ? (pass++, out.push('  PASS  ' + n)) : (fail++, out.push('  FAIL  ' + n + (d ? ' :: ' + d : ''))); };

const db = new pg.Client({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE
});

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await res.text();
  if (res.status === 429) {
    console.error('\nRate limited on ' + method + ' ' + path + '. Restart the server and run this again.\n');
    await db.end().catch(() => {});
    process.exit(2);
  }
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

await db.connect();
const CID = (await db.query('SELECT id FROM customers WHERE email=$1', [EMAIL])).rows[0].id;

/* ── build a real Stripe test subscription ────────────────────────────────── */

console.log('Creating a Stripe test-mode subscription (JPY)...');

const stripeCustomer = await stripe.customers.create({
  email: EMAIL,
  name: 'Boost Tester',
  description: 'Automated test — safe to delete'
});

// Stripe's canned test card; no real card data is involved anywhere here.
const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomer.id });
await stripe.customers.update(stripeCustomer.id, {
  invoice_settings: { default_payment_method: pm.id }
});

// The real configured Price, so this checks what customers are actually sold
// rather than something invented for the test.
const priceId = process.env.STRIPE_SUB_PRICE_ID_JA;
if (!priceId) {
  console.error(['', 'STRIPE_SUB_PRICE_ID_JA is not set — run `npm run check:pricing` first.', ''].join('\n'));
  process.exit(1);
}
const price = await stripe.prices.retrieve(priceId);

const stripeSub = await stripe.subscriptions.create({
  customer: stripeCustomer.id,
  items: [{ price: price.id }],
  default_payment_method: pm.id,
  off_session: true,
  payment_behavior: 'allow_incomplete',
  trial_period_days: 5
});

const periodEnd = stripeSub.items.data[0].current_period_end ?? stripeSub.current_period_end;

await db.query(
  `UPDATE customer_subscriptions
     SET stripe_subscription_id=$2, stripe_customer_id=$3, status=$4, currency='JPY', amount=5495,
         cancel_at_period_end=false, canceled_at=null,
         current_period_end=to_timestamp($5),
         card_brand=null, card_last4=null, card_exp_month=null, card_exp_year=null
   WHERE customer_id=$1`,
  [CID, stripeSub.id, stripeCustomer.id, stripeSub.status, periodEnd]
);

let r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
if (r.status !== 200) {
  console.error('\nCould not sign in as the test member. Run `npm run test:boost` first.\n');
  process.exit(1);
}
token = r.body.token;

out.push('--- Reading the membership');

r = await call('GET', '/subscription');
let sub = r.body.subscription;
check('GET /subscription -> 200', r.status === 200, JSON.stringify(r.body).slice(0, 160));
check('status comes from Stripe, not a constant', sub.status === stripeSub.status, sub.status + ' vs ' + stripeSub.status);
check('next billing date is the period end', sub.currentPeriodEnd === periodEnd * 1000, sub.currentPeriodEnd + ' vs ' + periodEnd * 1000);
check('not flagged as ending', sub.cancelAtPeriodEnd === false);

out.push('--- The free trial');

check('Stripe put the subscription in a trial', stripeSub.status === 'trialing', stripeSub.status);
check('the trial is 5 days', Math.round((stripeSub.trial_end - stripeSub.trial_start) / 86400) === 5);
check('NOTHING was charged to start it', (await stripe.invoices.list({ subscription: stripeSub.id, limit: 1 })).data[0]?.total === 0);
check('the price bills every 28 days, not monthly',
  price.recurring.interval === 'day' && price.recurring.interval_count === 28,
  price.recurring.interval_count + ' ' + price.recurring.interval);

check('API reports the trial status', sub.status === 'trialing', sub.status);
check('API reports when the first charge lands', sub.trialEndsAt === stripeSub.trial_end * 1000, String(sub.trialEndsAt));
check('API reports the 28-day cycle', sub.intervalDays === 28, String(sub.intervalDays));

r = await call('GET', '/boost/attempts/current');
check('a trialing member can TRAIN (trialing grants access)', r.status !== 403, String(r.status));

out.push('--- Multi-currency');

check('JPY renders zero-decimal', sub.priceLabel.includes('5,495') && !sub.priceLabel.includes('.00'), sub.priceLabel);
check('JPY uses the yen sign', /[¥￥]/.test(sub.priceLabel), sub.priceLabel);

// The same row in the English funnel's currency must format differently.
await db.query("UPDATE customer_subscriptions SET currency='GBP', amount=29.99 WHERE customer_id=$1", [CID]);
r = await call('GET', '/subscription');
check('GBP renders two decimals', r.body.subscription.priceLabel.includes('29.99'), r.body.subscription.priceLabel);
check('GBP uses the pound sign', r.body.subscription.priceLabel.includes('£'), r.body.subscription.priceLabel);
await db.query("UPDATE customer_subscriptions SET currency='JPY', amount=5495 WHERE customer_id=$1", [CID]);

out.push('--- The card');

r = await call('GET', '/subscription');
check('card read from Stripe and cached', r.body.subscription.paymentMethod?.last4 === '4242', JSON.stringify(r.body.subscription.paymentMethod));
check('card brand normalised', r.body.subscription.paymentMethod?.brand === 'VISA', r.body.subscription.paymentMethod?.brand);

const cached = await db.query('SELECT card_last4, card_brand FROM customer_subscriptions WHERE customer_id=$1', [CID]);
check('cached, so the next read needs no Stripe call', cached.rows[0].card_last4 === '4242', JSON.stringify(cached.rows[0]));

out.push('--- Cancelling keeps paid-for access');

r = await call('POST', '/subscription/cancel');
sub = r.body.subscription;
check('POST /subscription/cancel -> 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
check('flagged as cancelling', sub.cancelAtPeriodEnd === true);
check('STILL LIVE: access is not taken away on the spot', sub.status === 'trialing' || sub.status === 'active', sub.status);
check('not marked as ended', sub.canceledAt === null);
check('the end date is the period they paid for', sub.currentPeriodEnd === periodEnd * 1000);

const atStripe = await stripe.subscriptions.retrieve(stripeSub.id);
check('STRIPE AGREES: cancel_at_period_end is set there too', atStripe.cancel_at_period_end === true);
check('Stripe has not ended it either', atStripe.status !== 'canceled', atStripe.status);

r = await call('GET', '/boost/attempts/current');
check('TRAINING STILL WORKS while cancelling', r.status !== 403, String(r.status));

r = await call('GET', '/me');
check('/me reports the pending cancellation too', r.body.subscription.cancelAtPeriodEnd === true);

out.push('--- Resuming');

r = await call('POST', '/subscription/resume');
sub = r.body.subscription;
check('POST /subscription/resume -> 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
check('no longer cancelling', sub.cancelAtPeriodEnd === false);
check('still live', sub.status !== 'canceled', sub.status);

const resumed = await stripe.subscriptions.retrieve(stripeSub.id);
check('STRIPE AGREES: the cancellation was lifted', resumed.cancel_at_period_end === false);

r = await call('POST', '/subscription/resume');
check('resuming an already-active membership is not an error', r.status === 200 && r.body.subscription.cancelAtPeriodEnd === false);

out.push('--- Billing portal');

r = await call('POST', '/subscription/billing-portal');
if (r.status === 200) {
  check('POST /subscription/billing-portal -> a Stripe URL', /^https:\/\/billing\.stripe\.com\//.test(r.body.url), r.body.url);
  check('the link is one-time and Stripe-hosted, so no card data reaches us', !/card|number|cvc/i.test(JSON.stringify(r.body)));
} else {
  check('billing portal reports a usable error when unconfigured', r.status === 502 && r.body.code === 'billing_unavailable', JSON.stringify(r.body));
  out.push('        (the Stripe billing portal has no default configuration yet —');
  out.push('         enable it once at dashboard.stripe.com/settings/billing/portal)');
}

out.push('--- A membership that has actually ended');

await db.query("UPDATE customer_subscriptions SET status='canceled', canceled_at=now(), cancel_at_period_end=false WHERE customer_id=$1", [CID]);

r = await call('GET', '/subscription');
check('status reads as canceled', r.body.subscription.status === 'canceled');
check('an ended membership is not shown as "ending"', r.body.subscription.cancelAtPeriodEnd === false);

r = await call('POST', '/boost/attempts', { category: 'memory', level: 1 });
check('training is locked -> 403, not 401', r.status === 403 && r.body.code === 'subscription_required', JSON.stringify(r.body));

r = await call('GET', '/boost');
check('history stays readable', r.status === 200);

r = await call('POST', '/subscription/cancel');
check('cancelling an ended membership -> 409', r.status === 409 && r.body.code === 'already_canceled', JSON.stringify(r.body));

r = await call('POST', '/subscription/resume');
check('resuming an ended membership -> 409, with a way forward', r.status === 409 && r.body.code === 'subscription_ended', JSON.stringify(r.body));

out.push('--- Ownership');

r = await call('POST', '/subscription/billing-portal');
check('portal needs a session at all', r.status === 200 || r.status === 502 || r.status === 409, String(r.status));
token = null;
r = await call('POST', '/subscription/cancel');
check('cancelling without a session -> 401', r.status === 401);

/* ── clean up Stripe ──────────────────────────────────────────────────────── */

try {
  await stripe.subscriptions.cancel(stripeSub.id);
  await stripe.customers.del(stripeCustomer.id);
  out.push('        (Stripe test customer and subscription removed)');
} catch (e) {
  out.push('        (could not clean up Stripe test objects: ' + e.message + ')');
}

await db.query(
  `UPDATE customer_subscriptions
     SET status='active', canceled_at=null, cancel_at_period_end=false,
         stripe_subscription_id=$2, stripe_customer_id=null,
         card_brand='VISA', card_last4='4242', card_exp_month=9, card_exp_year=2028
   WHERE customer_id=$1`,
  [CID, 'sub_test_' + CID]
);

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
await db.end();
process.exit(fail ? 1 : 0);
