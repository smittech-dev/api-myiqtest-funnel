import { In } from 'typeorm';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { Customer } from '../entities/Customer.entity.js';
import { AppError } from '../utils/app-error.util.js';
import {
  AdminCustomerSummary,
  AdminPaginatedResult,
  AdminQuizListItem,
  AdminQuizListQuery
} from '../types/admin.types.js';

const TXN_TABLE = 'customer_quiz_result_payment_transactions';
const SUB_TABLE = 'customer_subscriptions';

export class AdminQuizService {
  private quizRepository = AppDataSource.getRepository(CustomerQuizResult);
  private transactionRepository = AppDataSource.getRepository(
    CustomerQuizResultPaymentTransaction
  );
  private subscriptionRepository = AppDataSource.getRepository(CustomerSubscription);
  private customerRepository = AppDataSource.getRepository(Customer);

  /**
   * Paginated submission list for the admin Quiz page.
   *
   * The purchase filters are EXISTS subqueries rather than joins so a quiz with
   * several transactions still counts once and the page size stays honest.
   * Only the current page's ids are then hydrated with transactions and
   * subscriptions, which keeps this to three queries regardless of table size.
   */
  async listSubmissions(
    query: AdminQuizListQuery
  ): Promise<AdminPaginatedResult<AdminQuizListItem>> {
    const { search, status = 'all', language = 'all', page, page_size, from, to } = query;

    const qb = this.quizRepository.createQueryBuilder('quiz');

    if (from) {
      qb.andWhere('quiz.created_at >= :from', { from });
    }
    if (to) {
      qb.andWhere('quiz.created_at <= :to', { to });
    }

    if (language !== 'all') {
      qb.andWhere('quiz.language = :language', { language });
    }

    if (search) {
      const term = search.trim();
      if (term) {
        // An operator can paste three different things into this box: the raw
        // database id, the encrypted token from a result URL or an email, or an
        // address. The token is the one they are most likely to have — it is
        // what appears in the links customers send to support — so it is
        // resolved to its id here rather than being treated as a failed email
        // search.
        const fromToken = /^\d+$/.test(term) ? null : EncryptionUtil.tryDecryptId(term);
        const id = /^\d+$/.test(term) ? term : fromToken;

        // quiz.id is a bigint; comparing it to a non-numeric string would make
        // Postgres throw, so the id branch is only added when there is one.
        if (id) {
          qb.andWhere('(quiz.id = :exactId OR quiz.email ILIKE :emailTerm)', {
            exactId: id,
            emailTerm: `%${term}%`
          });
        } else {
          qb.andWhere('quiz.email ILIKE :emailTerm', { emailTerm: `%${term}%` });
        }
      }
    }

    const succeededSale = (type: 'first_sale' | 'cross_sale') =>
      `SELECT 1 FROM ${TXN_TABLE} t WHERE t.customer_quiz_result_id = quiz.id` +
      ` AND t.transaction_type = '${type}' AND t.status = 'succeeded'`;

    if (status === 'first_sale') {
      qb.andWhere(`EXISTS (${succeededSale('first_sale')})`);
    } else if (status === 'cross_sale') {
      qb.andWhere(`EXISTS (${succeededSale('cross_sale')})`);
    } else if (status === 'subscription') {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${SUB_TABLE} s WHERE s.customer_quiz_result_id = quiz.id AND s.status = 'active')`
      );
    } else if (status === 'no_purchase') {
      qb.andWhere(`NOT EXISTS (${succeededSale('first_sale')})`);
    }

    qb.orderBy('quiz.created_at', 'DESC')
      .addOrderBy('quiz.id', 'DESC')
      .skip((page - 1) * page_size)
      .take(page_size);

    const [quizzes, total] = await qb.getManyAndCount();

    const items = await this.decorate(quizzes);

    return {
      items,
      total,
      page,
      page_size,
      total_pages: Math.max(1, Math.ceil(total / page_size))
    };
  }

  /** Attaches per-quiz sale and subscription summary to one page of results. */
  private async decorate(quizzes: CustomerQuizResult[]): Promise<AdminQuizListItem[]> {
    if (quizzes.length === 0) return [];

    const quizIds = quizzes.map((q) => q.id);

    const [transactions, subscriptions] = await Promise.all([
      this.transactionRepository.find({
        where: { customer_quiz_result_id: In(quizIds) }
      }),
      this.subscriptionRepository.find({
        where: { customer_quiz_result_id: In(quizIds) }
      })
    ]);

    return quizzes.map((quiz) => {
      const succeeded = transactions.filter(
        (t) => t.customer_quiz_result_id === quiz.id && t.status === 'succeeded'
      );
      const firstSale = succeeded.find((t) => t.transaction_type === 'first_sale') ?? null;
      const crossSale = succeeded.find((t) => t.transaction_type === 'cross_sale') ?? null;

      // An active plan is the headline; otherwise show whatever the latest one is.
      const quizSubs = subscriptions.filter((s) => s.customer_quiz_result_id === quiz.id);
      const subscription =
        quizSubs.find((s) => s.status === 'active') ??
        quizSubs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0] ??
        null;

      return {
        id: quiz.id,
        customer_id: quiz.customer_id,
        email: quiz.email,
        first_name: quiz.first_name,
        last_name: quiz.last_name,
        age: quiz.age,
        gender: quiz.gender,
        iq_score: quiz.iq_score,
        duration_seconds: quiz.duration_seconds,
        language: quiz.language,
        country_code: quiz.country_code,
        landing_url_details: quiz.landing_url_details,
        created_at: quiz.created_at,
        revenue: succeeded
          .reduce((sum, t) => sum + Number(t.amount), 0)
          .toFixed(2),
        has_first_sale: firstSale !== null,
        has_cross_sale: crossSale !== null,
        first_sale_amount: firstSale?.amount ?? null,
        cross_sale_amount: crossSale?.amount ?? null,
        subscription_status: subscription?.status ?? null
      };
    });
  }

  /**
   * Full record behind one submission: the quiz itself plus the customer
   * account, every payment attempt, and every subscription it produced.
   */
  async getSubmissionDetail(id: string): Promise<{
    quiz: CustomerQuizResult;
    customer: AdminCustomerSummary | null;
    transactions: CustomerQuizResultPaymentTransaction[];
    subscriptions: CustomerSubscription[];
  }> {
    if (!/^\d+$/.test(id)) {
      throw new AppError('Invalid quiz id.', 400);
    }

    const quiz = await this.quizRepository.findOne({ where: { id } });
    if (!quiz) {
      throw new AppError(`No quiz submission found with id ${id}.`, 404);
    }

    const [customer, transactions, subscriptions] = await Promise.all([
      quiz.customer_id
        ? this.customerRepository.findOne({ where: { id: quiz.customer_id } })
        : Promise.resolve(null),
      this.transactionRepository.find({
        where: { customer_quiz_result_id: id },
        order: { created_at: 'DESC' }
      }),
      this.subscriptionRepository.find({
        where: { customer_quiz_result_id: id },
        order: { created_at: 'DESC' }
      })
    ]);

    return {
      quiz,
      // Mapped field by field so the customer's password_hash can never reach
      // the panel by someone later adding a column to the entity.
      customer: customer
        ? {
            id: customer.id,
            email: customer.email,
            email_verified: customer.email_verified,
            status: customer.status,
            stripe_customer_id: customer.stripe_customer_id,
            created_at: customer.created_at
          }
        : null,
      transactions,
      subscriptions
    };
  }
}

export const adminQuizService = new AdminQuizService();
