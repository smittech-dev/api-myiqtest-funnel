import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';

export type FunnelRedirect =
  | 'CHECKOUT_PAGE'
  | 'CROSS_SELL_PAGE'
  | 'CUSTOMER_DETAILS_PAGE'
  | 'THANK_YOU_PAGE';

/** The funnel in which the email arrives with the payment. See `funnel_version`. */
export const EMAIL_AT_PAYMENT_FUNNEL = 2;

/**
 * Derive the page a customer belongs on from succeeded payments, saved
 * demographics and a recorded upsell decision.
 *
 * Two page orders, chosen by the attempt's `funnel_version`:
 *
 *   current (2)   checkout → details → upsell → thank you
 *   previous      checkout → upsell → details → thank you
 *
 * Details moved ahead of the upsell because a wallet payer gives us their email
 * address on that page, and it needs to arrive within minutes of the payment.
 * The previous order is kept for every attempt made before that, so no
 * historical customer is re-routed — someone who skipped the upsell months ago
 * and opens their report link today still lands on the report.
 *
 * Pure and derived (no stored "current page" column), so it cannot drift from
 * the payment record. The `transactions` relation must be loaded, otherwise
 * everything reads as unpaid.
 */
export function resolveFunnelRedirect(result: CustomerQuizResult): FunnelRedirect {
  const hasPaidFirstSale =
    result.transactions?.some(
      (tx) => tx.transaction_type === 'first_sale' && tx.status === 'succeeded'
    ) ?? false;

  const hasPaidCrossSale =
    result.transactions?.some(
      (tx) => tx.transaction_type === 'cross_sale' && tx.status === 'succeeded'
    ) ?? false;

  const crossSellSettled = hasPaidCrossSale || Boolean(result.cross_sell_declined_at);
  const demographicsCompleted = Boolean(result.first_name && result.last_name);

  if (!hasPaidFirstSale) {
    return 'CHECKOUT_PAGE';
  }

  if ((result.funnel_version ?? 0) >= EMAIL_AT_PAYMENT_FUNNEL) {
    if (!demographicsCompleted) return 'CUSTOMER_DETAILS_PAGE';
    // Details are in; the upsell is the last stop until it is bought or
    // turned down — and "turned down" is now recorded, so a decliner is not
    // sent back to it from a new tab or the report email.
    return crossSellSettled ? 'THANK_YOU_PAGE' : 'CROSS_SELL_PAGE';
  }

  // The previous order. Completed demographics win over an unbought upsell:
  // nothing used to record "declined", so without this someone who skipped the
  // upsell and then filled in their details would be sent back to it forever.
  if (demographicsCompleted) {
    return 'THANK_YOU_PAGE';
  }

  // A recorded decline counts too, for an old-order attempt finished in a
  // browser that has since picked up the current frontend.
  if (!crossSellSettled) {
    return 'CROSS_SELL_PAGE';
  }

  return 'CUSTOMER_DETAILS_PAGE';
}
