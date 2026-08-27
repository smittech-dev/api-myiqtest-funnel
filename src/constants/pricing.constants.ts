import { config } from '../config/env.config.js';
import { discountCodes } from '../config/discount-codes.config.js';

export interface ProductPricing {
  amount: number;
  currency: 'JPY' | 'GBP';
  stripe_amount: number; // JPY: zero-decimal (2980), GBP: pence (1999)
  title: string;
}

export interface SubscriptionPricing {
  price_id: string; // Stripe Price ID
  amount: number;
  currency: 'JPY' | 'GBP';
  title: string;
}

export interface LanguagePricingConfig {
  currency: 'JPY' | 'GBP';
  first_sale: ProductPricing;
  cross_sale: ProductPricing;
  subscription: SubscriptionPricing;
}

export const FUNNEL_PRICING: Record<'ja' | 'en', LanguagePricingConfig> = {
  ja: {
    currency: 'JPY',
    first_sale: {
      amount: 2980,
      currency: 'JPY',
      stripe_amount: 2980, // Zero-decimal in Stripe
      title: '公式IQ認定証＋詳細診断レポート'
    },
    cross_sale: {
      amount: 1480,
      currency: 'JPY',
      stripe_amount: 1480, // Zero-decimal in Stripe
      title: 'プレミアム適職・キャリア分析レポート'
    },
    subscription: {
      price_id: config.subscription.priceIdJa,
      amount: 980,
      currency: 'JPY',
      title: 'IQ脳力トレーニング月額プラン'
    }
  },
  en: {
    currency: 'GBP',
    first_sale: {
      amount: 19.99,
      currency: 'GBP',
      stripe_amount: 1999, // Pence in Stripe (19.99 * 100)
      title: 'Official IQ Certificate & Detailed Report'
    },
    cross_sale: {
      amount: 9.99,
      currency: 'GBP',
      stripe_amount: 999, // Pence in Stripe (9.99 * 100)
      title: 'Career Aptitude & Personality Report'
    },
    subscription: {
      price_id: config.subscription.priceIdEn,
      amount: 6.99,
      currency: 'GBP',
      title: 'Monthly IQ Brain Training'
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
