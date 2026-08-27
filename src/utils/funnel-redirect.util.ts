import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';

export type FunnelRedirect =
  | 'CHECKOUT_PAGE'
  | 'CROSS_SELL_PAGE'
  | 'CUSTOMER_DETAILS_PAGE'
  | 'THANK_YOU_PAGE';

/**
 * Derive the page a customer belongs on from succeeded payments and saved demographics.
 *
 * Precedence: unpaid first sale -> checkout; completed demographics -> thank you;
 * unbought upsell -> cross-sell; otherwise the details form.
 *
 * This is pure and derived (no stored funnel column), so it cannot drift from the
 * payment record. The quiz results endpoint and the payment confirm endpoints both
 * answer with it, which is why it lives here rather than inside either service.
 *
 * The `transactions` relation must be loaded, otherwise everything reads as unpaid.
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

  const demographicsCompleted = Boolean(result.first_name && result.last_name);

  if (!hasPaidFirstSale) {
    return 'CHECKOUT_PAGE';
  }

  // Completed demographics win over an unbought upsell. Without this, someone who
  // declined the cross-sell and then filled in their details would be sent back to
  // the cross-sell forever, since nothing records "declined".
  if (demographicsCompleted) {
    return 'THANK_YOU_PAGE';
  }

  if (!hasPaidCrossSale) {
    return 'CROSS_SELL_PAGE';
  }

  return 'CUSTOMER_DETAILS_PAGE';
}
