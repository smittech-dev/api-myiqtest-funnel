/**
 * Checks the configured Stripe Prices against what the app displays.
 *
 *   npm run check:pricing
 *
 * A Stripe Price is immutable: its amount and its billing interval are fixed
 * when it is created. So the figures in `pricing.constants.ts` are only what we
 * *show* — Stripe decides what is actually charged, and nothing in the codebase
 * makes the two agree.
 *
 * That gap is the expensive one. A customer shown "£29.99 every 28 days" and
 * charged £6.99 monthly is a support queue; charged more than they were shown is
 * a chargeback and a regulator. This compares the two and says exactly what to
 * create when they differ.
 *
 * Read-only. It creates nothing and changes nothing.
 */
import dotenv from 'dotenv';
import Stripe from 'stripe';
dotenv.config();

const { FUNNEL_PRICING, SUBSCRIPTION_INTERVAL_DAYS, SUBSCRIPTION_TRIAL_DAYS } = await import(
  '../src/constants/pricing.constants.ts'
);

const key = process.env.STRIPE_SECRET_KEY || '';
if (!/^sk_(test|live)_/.test(key)) {
  console.error('\nSTRIPE_SECRET_KEY is not set to a real key — cannot verify prices.\n');
  process.exit(1);
}

const mode = key.startsWith('sk_live_') ? 'LIVE' : 'test';
const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });

/** Stripe holds zero-decimal currencies whole and everything else in minor units. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
const toMinorUnits = (amount, currency) =>
  ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100);
const fromMinorUnits = (amount, currency) =>
  ZERO_DECIMAL.has(currency) ? amount : amount / 100;

const problems = [];
const notes = [];

console.log(`\nStripe account: ${mode} mode`);
console.log(`Expected cycle: every ${SUBSCRIPTION_INTERVAL_DAYS} days, after a ${SUBSCRIPTION_TRIAL_DAYS}-day trial\n`);

for (const [language, pricing] of Object.entries(FUNNEL_PRICING)) {
  const sub = pricing.subscription;
  const currency = sub.currency;
  const expected = toMinorUnits(sub.amount, currency);

  console.log(`[${language}] one-off prices are charged by amount, so only the subscription has a Price object`);
  console.log(`  first sale   ${pricing.first_sale.amount} ${currency}  (stripe_amount ${pricing.first_sale.stripe_amount})`);
  console.log(`  cross sale   ${pricing.cross_sale.amount} ${currency}  (stripe_amount ${pricing.cross_sale.stripe_amount})`);
  console.log(`  subscription ${sub.amount} ${currency} every ${sub.interval_days}d`);

  // The one-off amounts are passed to PaymentIntents directly, so the only
  // thing to verify is that the minor-unit conversion is right.
  for (const [name, product] of [
    ['first_sale', pricing.first_sale],
    ['cross_sale', pricing.cross_sale]
  ]) {
    const want = toMinorUnits(product.amount, product.currency);
    if (product.stripe_amount !== want) {
      problems.push(
        `[${language}] ${name}: stripe_amount is ${product.stripe_amount} but ${product.amount} ${product.currency} is ${want} in minor units`
      );
    }
  }

  if (!sub.price_id) {
    problems.push(
      `[${language}] subscription: no Stripe Price id configured ` +
        `(STRIPE_SUB_PRICE_ID_${language.toUpperCase()} is empty)`
    );
    notes.push(createInstruction(language, sub, currency, expected));
    console.log('  Stripe Price: NOT CONFIGURED\n');
    continue;
  }

  let price;
  try {
    price = await stripe.prices.retrieve(sub.price_id);
  } catch (error) {
    problems.push(`[${language}] subscription: Price ${sub.price_id} could not be read — ${error.message}`);
    console.log(`  Stripe Price: ${sub.price_id} — NOT FOUND\n`);
    continue;
  }

  const priceCurrency = price.currency.toUpperCase();
  const interval = price.recurring?.interval;
  const intervalCount = price.recurring?.interval_count ?? 1;
  const intervalDays = interval === 'day' ? intervalCount : null;

  console.log(
    `  Stripe Price: ${price.id} — ${fromMinorUnits(price.unit_amount, priceCurrency)} ${priceCurrency} ` +
      `every ${intervalCount} ${interval}${intervalCount === 1 ? '' : 's'}${price.active ? '' : ' (INACTIVE)'}`
  );

  if (!price.active) {
    problems.push(`[${language}] subscription: Price ${price.id} is archived and cannot be used`);
  }
  if (priceCurrency !== currency) {
    problems.push(`[${language}] subscription: Price is in ${priceCurrency}, the app shows ${currency}`);
  }
  if (price.unit_amount !== expected) {
    problems.push(
      `[${language}] subscription: CHARGES ${fromMinorUnits(price.unit_amount, priceCurrency)} ${priceCurrency} ` +
        `but the app SHOWS ${sub.amount} ${currency}`
    );
  }
  if (intervalDays !== SUBSCRIPTION_INTERVAL_DAYS) {
    problems.push(
      `[${language}] subscription: bills every ${intervalCount} ${interval}(s), ` +
        `the app shows every ${SUBSCRIPTION_INTERVAL_DAYS} days`
    );
  }

  if (problems.some((p) => p.startsWith(`[${language}] subscription`))) {
    notes.push(createInstruction(language, sub, currency, expected));
  }

  console.log('');
}

function createInstruction(language, sub, currency, minorUnits) {
  return [
    `[${language}] create a replacement Price and set STRIPE_SUB_PRICE_ID_${language.toUpperCase()} to its id:`,
    '',
    '    stripe prices create \\',
    `      --currency=${currency.toLowerCase()} \\`,
    `      --unit-amount=${minorUnits} \\`,
    `      -d "recurring[interval]=day" \\`,
    `      -d "recurring[interval_count]=${SUBSCRIPTION_INTERVAL_DAYS}" \\`,
    `      -d "product_data[name]=${sub.title}"`,
    '',
    '    An existing Price cannot be edited — amount and interval are immutable at',
    '    Stripe. Subscribers on the old Price keep their old terms until migrated.'
  ].join('\n');
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  if (notes.length) {
    console.error('\nTo fix:\n');
    for (const note of notes) console.error(note + '\n');
  }
  if (mode === 'LIVE') {
    console.error('  This is the LIVE account. Customers are affected right now.\n');
  }
  process.exit(1);
}

console.log('✓ Stripe charges exactly what the app displays, on the interval it displays\n');
