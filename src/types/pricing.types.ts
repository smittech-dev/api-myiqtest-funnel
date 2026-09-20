export interface PricedProduct {
  title: string;
  currency: 'JPY' | 'GBP';
  /** List price before any discount. */
  original_price: number;
  /** What the customer actually pays. */
  price: number;
  discount_percentage: number;
  /** Smallest currency unit, ready for Stripe (JPY 2980, GBP 1999). */
  stripe_amount: number;
}

export interface SubscriptionPricedProduct extends PricedProduct {
  price_id: string;
  /**
   * Days between charges — 28, not a calendar month.
   *
   * Sent so the checkout can state the actual cycle. "Monthly" beside a 28-day
   * subscription is thirteen charges a year described as twelve, which is the
   * kind of mismatch that turns into chargebacks.
   */
  interval_days: number;
  /** Free days before the first charge. 0 when there is no trial. */
  trial_days: number;
}

export interface PricingResponseData {
  language: 'ja' | 'en';
  currency: 'JPY' | 'GBP';
  /** Discount requested via price_dis, echoed back. */
  discount_percentage: number;
  /** Canonical code that was matched, or null when no discount applied. */
  discount_code: string | null;
  first_sale: PricedProduct;
  cross_sale: PricedProduct;
  subscription: SubscriptionPricedProduct;
}
