import { config } from '../config/env.config.js';
import { discountCodes } from '../config/discount-codes.config.js';

export interface ProductPricing {
  amount: number;
  currency: 'JPY' | 'GBP';
  stripe_amount: number; // JPY: zero-decimal (2980), GBP: pence (1999)
  /** What the customer is shown, in the language they bought in. */
  title: string;
  /**
   * What Stripe is told, always in English.
   *
   * Everything on the Stripe side — the PaymentIntent description, the row in
   * the Dashboard, the export a finance team or an auditor reads — is read by
   * people who do not read Japanese. `title` is the customer's language and
   * belongs on the customer's screen; this is the operator's, and the two must
   * not be the same field or the Japanese funnel fills Stripe with Japanese.
   */
  stripe_description: string;
}

export interface SubscriptionPricing {
  /**
   * Stripe Price ID.
   *
   * The amount and the billing interval live on the Price object at Stripe and
   * are immutable there — `amount` and `interval_days` below are what we display
   * and must be kept equal to it. `npm run check:pricing` compares the two
   * against the live Stripe account rather than trusting that they match.
   */
  price_id: string;
  amount: number;
  currency: 'JPY' | 'GBP';
  /** What the customer is shown, in the language they bought in. */
  title: string;
  /** What Stripe is told, always in English. See `ProductPricing`. */
  stripe_description: string;
  /**
   * Days between charges. 28, not a calendar month — so the renewal date walks
   * backwards through the month and "monthly" is the wrong word everywhere.
   */
  interval_days: number;
  /** Free days before the first charge. */
  trial_days: number;
}

export interface LanguagePricingConfig {
  currency: 'JPY' | 'GBP';
  first_sale: ProductPricing;
  cross_sale: ProductPricing;
  subscription: SubscriptionPricing;
}

/**
 * The subscription bills every 28 days, not monthly.
 *
 * Thirteen charges a year rather than twelve, and a renewal date that walks
 * backwards through the calendar. It is why nothing in the product says
 * "monthly": a customer who is told "monthly" and charged on the 3rd, the 31st
 * and the 28th has been misled, and that is a chargeback.
 */
export const SUBSCRIPTION_INTERVAL_DAYS = 28;

/** Free days before the first charge. */
export const SUBSCRIPTION_TRIAL_DAYS = 5;

export const FUNNEL_PRICING: Record<'ja' | 'en', LanguagePricingConfig> = {
  ja: {
    currency: 'JPY',
    first_sale: {
      amount: 199,
      currency: 'JPY',
      stripe_amount: 199, // Zero-decimal in Stripe
      title: '公式IQ認定証＋詳細診断レポート',
      stripe_description: 'Official IQ Certificate & Detailed Report'
    },
    cross_sale: {
      amount: 1990,
      currency: 'JPY',
      stripe_amount: 1990, // Zero-decimal in Stripe
      title: 'プレミアム適職・キャリア分析レポート',
      stripe_description: 'Premium Career Aptitude & Personality Report'
    },
    subscription: {
      price_id: config.subscription.priceIdJa,
      amount: 5495,
      currency: 'JPY',
      title: 'myIQ認知トレーニングプログラム',
      stripe_description: 'myIQ Cognitive Training Program',
      interval_days: SUBSCRIPTION_INTERVAL_DAYS,
      trial_days: SUBSCRIPTION_TRIAL_DAYS
    }
  },
  en: {
    currency: 'GBP',
    first_sale: {
      amount: 2.99,
      currency: 'GBP',
      stripe_amount: 299, // Pence in Stripe (2.99 * 100)
      title: 'Official IQ Certificate & Detailed Report',
      stripe_description: 'Official IQ Certificate & Detailed Report'
    },
    cross_sale: {
      amount: 7.99,
      currency: 'GBP',
      stripe_amount: 799, // Pence in Stripe (7.99 * 100)
      title: 'Career Aptitude & Personality Report',
      stripe_description: 'Career Aptitude & Personality Report'
    },
    subscription: {
      price_id: config.subscription.priceIdEn,
      amount: 29.99,
      currency: 'GBP',
      title: 'myIQ Cognitive Training Program',
      stripe_description: 'myIQ Cognitive Training Program',
      interval_days: SUBSCRIPTION_INTERVAL_DAYS,
      trial_days: SUBSCRIPTION_TRIAL_DAYS
    }
  }
};

/**
 * Utility helper to get pricing config by language ('ja' | 'en')
 */
export function getPricingByLanguage(language?: string): LanguagePricingConfig {
  const lang = language?.toLowerCase() === 'en' ? 'en' : 'ja';
  return FUNNEL_PRICING[lang];
}

export interface ResolvedDiscount {
  /** Canonical code as configured, uppercased. */
  code: string;
  percent: number;
}

/** Every configured code. Kept for diagnostics — do not expose these publicly. */
export const DISCOUNT_CODES = Object.keys(discountCodes);

/**
 * Resolve a discount code sent by the frontend.
 *
 * Accepts either a plain code (`K75QSQC`) or one personalised with the first two
 * letters of the customer's email plus an underscore (`pu_K75QSQC`). The plain form is
 * tried first, so a configured code is never mangled by the prefix rule; only if
 * that fails and the value looks prefixed are the leading three characters dropped
 * and the lookup retried.
 *
 * Returns null when the code is empty or unknown.
 */
export function resolveDiscountCode(raw?: string | null): ResolvedDiscount | null {
  const value = (raw || '').trim();
  if (!value) {
    return null;
  }

  const direct = lookupCode(value);
  if (direct) {
    return direct;
  }

  // Personalised form: two letters from the email, an underscore, then the code
  if (/^[A-Za-z]{2}_/.test(value)) {
    return lookupCode(value.slice(3));
  }

  return null;
}

function lookupCode(candidate: string): ResolvedDiscount | null {
  const code = candidate.trim().toUpperCase();
  const entry = discountCodes[code];
  return entry === undefined ? null : { code: entry.code, percent: entry.discount };
}

/**
 * Apply a percentage discount to a product.
 *
 * The Stripe amount is discounted first and rounded to a whole unit, then the
 * display price is derived from it — so what we show can never disagree with what
 * Stripe charges. JPY is zero-decimal, GBP is pence.
 */
export function applyDiscount(
  product: ProductPricing,
  percent: number
): ProductPricing & { original_price: number; discount_percentage: number } {
  const safePercent = percent > 0 && percent < 100 ? percent : 0;

  if (safePercent === 0) {
    return {
      ...product,
      original_price: product.amount,
      discount_percentage: 0
    };
  }

  const discountedStripeAmount = Math.round((product.stripe_amount * (100 - safePercent)) / 100);
  const isZeroDecimal = product.currency === 'JPY';

  return {
    ...product,
    amount: isZeroDecimal ? discountedStripeAmount : discountedStripeAmount / 100,
    stripe_amount: discountedStripeAmount,
    original_price: product.amount,
    discount_percentage: safePercent
  };
}
