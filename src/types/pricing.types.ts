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
