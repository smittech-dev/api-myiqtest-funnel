import { getPricingByLanguage, applyDiscount, resolveDiscountCode } from '../constants/pricing.constants.js';
import { PricingResponseData, PricedProduct } from '../types/pricing.types.js';

export class PricingService {
  /**
   * Return the three funnel prices for a language, with the discount applied.
   *
   * Only the first sale is discountable: it is the one the customer can pay at a
   * reduced price via `price_dis`. The upsell and the subscription are charged at
   * list price by their own endpoints, so they are reported at list price here —
   * showing them discounted would not match what actually gets charged.
   *
   * `discountCode` is the code the frontend presented; an unknown or empty code
   * simply means no discount.
   */
  getPricing(language: string, discountCode?: string | null): PricingResponseData {
    const lang = language.toLowerCase() === 'en' ? 'en' : 'ja';
    const config = getPricingByLanguage(lang);

    const discount = resolveDiscountCode(discountCode);
    const firstSale = applyDiscount(config.first_sale, discount?.percent ?? 0);
    const crossSale = applyDiscount(config.cross_sale, 0);
    const subscription = config.subscription;

    return {
      language: lang,
      currency: config.currency,
      discount_percentage: firstSale.discount_percentage,
      discount_code: discount ? discount.code : null,
      first_sale: toPricedProduct(firstSale),
      cross_sale: toPricedProduct(crossSale),
      subscription: {
        title: subscription.title,
        currency: subscription.currency,
        original_price: subscription.amount,
        price: subscription.amount,
        discount_percentage: 0,
        // Subscriptions are billed by Stripe from the Price id, not an amount
        stripe_amount: subscription.currency === 'JPY'
          ? subscription.amount
          : Math.round(subscription.amount * 100),
        price_id: subscription.price_id,
        // The checkout has to be able to state the real terms: a free trial of
        // this many days, then this amount every this many days.
        interval_days: subscription.interval_days,
        trial_days: subscription.trial_days
      }
    };
  }
}

function toPricedProduct(
  product: { title: string; currency: 'JPY' | 'GBP'; amount: number; stripe_amount: number; original_price: number; discount_percentage: number }
): PricedProduct {
  return {
    title: product.title,
    currency: product.currency,
    original_price: product.original_price,
    price: product.amount,
    discount_percentage: product.discount_percentage,
    stripe_amount: product.stripe_amount
  };
}

export const pricingService = new PricingService();
