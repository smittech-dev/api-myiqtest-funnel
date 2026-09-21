import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { reportUrlFor, type ReportKind } from '../utils/report-url.util.js';

/**
 * The documents a member bought through the funnel, surfaced inside the
 * members' area.
 *
 * They paid for a certificate and, sometimes, a career report — and until now
 * the only copy of those links was an email they received once. Putting them on
 * the dashboard means the thing they bought is somewhere they can find it,
 * which is also the cheapest support ticket never raised.
 */

export interface MemberDocument {
  kind: ReportKind;
  title: string;
  blurb: string;
  url: string;
  /** When the purchase settled, so the card can say how long they have had it. */
  purchasedAt: number;
}

const COPY: Record<ReportKind, { title: string; blurb: string }> = {
  first_sale: {
    title: 'IQ certificate & detailed report',
    blurb: 'Your official result, the full breakdown by category, and how you compare to your age group.'
  },
  cross_sale: {
    title: 'Career & aptitude report',
    blurb: 'Where your reasoning profile fits at work, and the roles it suits best.'
  }
};

/**
 * Every document this member has actually paid for.
 *
 * Entitlement is read from settled transactions rather than inferred from the
 * quiz result existing: the cross-sale is optional, and offering a member a
 * link to a report they declined would be both confusing and, if the page
 * happened to render, a give-away.
 *
 * Returns an empty list rather than throwing when there is nothing — a member
 * whose purchase has not settled yet simply sees no card.
 */
export async function documentsFor(customerId: string): Promise<MemberDocument[]> {
  const quizResult = await AppDataSource.getRepository(CustomerQuizResult).findOne({
    where: { customer_id: customerId },
    order: { created_at: 'DESC' }
  });

  if (!quizResult) return [];

  const transactions = await AppDataSource.getRepository(CustomerQuizResultPaymentTransaction).find({
    where: { customer_quiz_result_id: quizResult.id, status: 'succeeded' }
  });

  const settled = (kind: ReportKind) =>
    transactions.find((tx) => tx.transaction_type === kind) ?? null;

  const documents: MemberDocument[] = [];

  for (const kind of ['first_sale', 'cross_sale'] as ReportKind[]) {
    const transaction = settled(kind);
    if (!transaction) continue;

    documents.push({
      kind,
      ...COPY[kind],
      url: reportUrlFor(quizResult, kind),
      purchasedAt: transaction.created_at.getTime()
    });
  }

  return documents;
}
