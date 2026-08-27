import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { AdminDashboardStats, DateRangeFilter } from '../types/admin.types.js';
import { SelectQueryBuilder } from 'typeorm';

/**
 * Dashboard KPIs for the admin panel.
 *
 * Every number is a **cohort** measured against the quiz submission date, not
 * the payment date: "of the quizzes submitted in this window, how many turned
 * into a first sale / cross sale / active subscription". That keeps the four
 * KPIs comparable to each other — a conversion rate off these numbers is
 * meaningful, which would not be true if sales were counted by charge date
 * while submissions were counted by submission date.
 */
export class AdminDashboardService {
  private quizRepository = AppDataSource.getRepository(CustomerQuizResult);
  private transactionRepository = AppDataSource.getRepository(
    CustomerQuizResultPaymentTransaction
  );
  private subscriptionRepository = AppDataSource.getRepository(CustomerSubscription);

  /** Applies the shared date window to whichever alias holds the quiz row. */
  private applyRange<T extends object>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    range: DateRangeFilter
  ): SelectQueryBuilder<T> {
    if (range.from) {
      qb.andWhere(`${alias}.created_at >= :from`, { from: range.from });
    }
    if (range.to) {
      qb.andWhere(`${alias}.created_at <= :to`, { to: range.to });
    }
    return qb;
  }

  async getStats(range: DateRangeFilter): Promise<AdminDashboardStats> {
    const quizQuery = this.applyRange(
      this.quizRepository.createQueryBuilder('quiz'),
      'quiz',
      range
    );

    const saleQuery = (type: 'first_sale' | 'cross_sale') =>
      this.applyRange(
        this.transactionRepository
          .createQueryBuilder('txn')
          .innerJoin('customer_quiz_results', 'quiz', 'quiz.id = txn.customer_quiz_result_id')
          .where('txn.transaction_type = :type', { type })
          .andWhere('txn.status = :status', { status: 'succeeded' }),
        'quiz',
        range
      );

    const subscriptionQuery = this.applyRange(
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoin('customer_quiz_results', 'quiz', 'quiz.id = sub.customer_quiz_result_id')
        .where('sub.status = :status', { status: 'active' }),
      'quiz',
      range
    );

    // Run the four counts concurrently; they touch different tables.
    const [totalQuizSubmitted, totalFirstSale, totalCrossSale, totalActiveSubscription] =
      await Promise.all([
        quizQuery.getCount(),
        saleQuery('first_sale').getCount(),
        saleQuery('cross_sale').getCount(),
        subscriptionQuery.getCount()
      ]);

    return {
      total_quiz_submitted: totalQuizSubmitted,
      total_first_sale: totalFirstSale,
      total_cross_sale: totalCrossSale,
      total_active_subscription: totalActiveSubscription
    };
  }
}

export const adminDashboardService = new AdminDashboardService();
