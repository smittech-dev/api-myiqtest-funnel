import crypto from 'crypto';
import type { Repository } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { Customer } from '../entities/Customer.entity.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { QuizSubmitPayload } from '../types/quiz.types.js';
import { resolveFunnelRedirect, FunnelRedirect } from '../utils/funnel-redirect.util.js';
import {
  isPlaceholderEmail,
  normaliseEmail,
  placeholderEmailFor
} from '../utils/placeholder-email.util.js';

export class QuizService {
  private quizResultRepository = AppDataSource.getRepository(CustomerQuizResult);

  /**
   * Store a finished quiz and open the funnel session for it.
   *
   * The funnel no longer asks for an email before checkout, so the current
   * frontend submits without one. The attempt then gets a customer of its own
   * on a placeholder address, `dummy_{quizId}@noumirai.com`, which the real
   * address replaces once it arrives with the payment — see
   * `customerEmailService`.
   *
   * An email is still accepted when it is sent. That is the previous frontend:
   * a visitor whose browser still holds the old bundle went through the email
   * page and walks the old page order, and is served by the old behaviour —
   * attached to whoever owns that address, and routed by the old rules
   * (`funnel_version` stays null).
   *
   * No address is verified with Reoon any more. Its only consumer was the
   * abandoned-checkout sequence, which has been retired along with the page
   * that fed it, and an address typed at the moment of paying has just been
   * accepted by Stripe for that payment.
   */
  async submitQuiz(payload: QuizSubmitPayload, ipAddress?: string): Promise<{
    quiz_id: string;
  }> {
    const {
      email: rawEmail,
      iq_score,
      category_scores,
      duration_seconds,
      language = 'ja',
      landing_url_details
    } = payload;

    const email = rawEmail ? normaliseEmail(rawEmail) : null;
    const lang = language.toLowerCase() === 'en' ? 'en' : 'ja';

    // Customer and quiz result are written in one transaction, so a failure in
    // either never leaves the other behind on its own.
    const savedResult = await AppDataSource.transaction(async (manager) => {
      const customerRepo = manager.getRepository(Customer);
      const quizRepo = manager.getRepository(CustomerQuizResult);

      const attempt = {
        iq_score: Math.round(iq_score),
        category_scores: category_scores || null,
        duration_seconds: duration_seconds || null,
        language: lang,
        // Clamped to the column: an over-long value must never cost the quiz.
        ip_address: ipAddress ? ipAddress.slice(0, 100) : null,
        country_code: lang === 'ja' ? 'JP' : 'US',
        landing_url_details: landing_url_details || null,
        report_urls: null
      };

      if (email) {
        const customer = await this.findOrCreateCustomer(customerRepo, email);
        return quizRepo.save(quizRepo.create({ ...attempt, customer_id: customer.id, email: customer.email }));
      }

      // The placeholder is built from the attempt's own id, which exists only
      // once the row is written — and the row needs an address to be written.
      // So it is written first with a throwaway one, then both rows take the
      // real placeholder before the transaction commits. Nobody outside the
      // transaction ever sees the throwaway.
      const transient = `pending_${crypto.randomUUID()}@noumirai.invalid`;
      const quiz = await quizRepo.save(
        quizRepo.create({ ...attempt, customer_id: null, email: transient, funnel_version: 2 })
      );

      const placeholder = placeholderEmailFor(quiz.id);
      const customer = await customerRepo.save(
        customerRepo.create({
          email: placeholder,
          password_hash: crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'),
          // Cannot sign in until a payment activates the account, and even then
          // not until a real address and a password are issued with it.
          status: 'inactive'
        })
      );

      quiz.customer_id = customer.id;
      quiz.email = placeholder;
      return quizRepo.save(quiz);
    });

    return {
      quiz_id: EncryptionUtil.encryptId(savedResult.id)
    };
  }

  /**
   * The customer who owns this address, matched case-insensitively, or a new
   * one. `orIgnore` covers two submits for a new address racing each other:
   * the loser skips the insert and reads back the winner's row.
   */
  private async findOrCreateCustomer(
    customerRepo: Repository<Customer>,
    email: string
  ): Promise<Customer> {
    const existing = await customerRepo
      .createQueryBuilder('c')
      .where('LOWER(c.email) = :email', { email })
      .getOne();
    if (existing) return existing;

    await customerRepo
      .createQueryBuilder()
      .insert()
      .values({
        email,
        password_hash: crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'),
        status: 'inactive'
      })
      .orIgnore()
      .execute();

    return customerRepo
      .createQueryBuilder('c')
      .where('LOWER(c.email) = :email', { email })
      .getOneOrFail();
  }

  /**
   * Redirect Guard: Resolve which page the user belongs on
   * Returns redirect_url enum, quiz data, and customer data
   */
  async getQuizResults(quizId: string): Promise<{
    redirect_url: FunnelRedirect;
    quiz: {
      quiz_id: string;
      iq_score: number | null;
      category_scores: Record<string, number> | null;
      language: string;
      duration_seconds: number | null;
    };
    customer: {
      email: string;
      first_name: string | null;
      last_name: string | null;
      age: string | null;
    };
  }> {
    let numericId: string;
    try {
      numericId = EncryptionUtil.decryptId(quizId);
    } catch {
      throw new AppError('Invalid quiz_id', 400);
    }

    const result = await this.quizResultRepository.findOne({
      where: { id: numericId },
      relations: ['transactions']
    });

    if (!result) {
      throw new AppError('Quiz result not found', 404);
    }

    // Determine redirect_url from payment + demographic state
    const redirectUrl = resolveFunnelRedirect(result);

    // Re-encrypt the id for response
    const encryptedQuizId = EncryptionUtil.encryptId(result.id);

    return {
      redirect_url: redirectUrl,
      quiz: {
        quiz_id: encryptedQuizId,
        iq_score: result.iq_score,
        category_scores: result.category_scores,
        language: result.language,
        duration_seconds: result.duration_seconds
      },
      customer: {
        // Never the placeholder: it is ours, not the customer's, and a page
        // that printed it would be showing them an address that is not theirs.
        email: isPlaceholderEmail(result.email) ? '' : result.email,
        first_name: result.first_name,
        last_name: result.last_name,
        age: result.age
      }
    };
  }

  /**
   * Everything the thank-you page renders, in one call.
   *
   * The funnel sells two reports — the certificate and detailed report as the
   * first sale, the career and aptitude report as the cross-sale — and which
   * of them a customer may open is decided purely by which payments succeeded.
   * Those two booleans are the whole of `report`: what the documents look like
   * is the frontend's business, and nothing about them is worth deriving twice.
   *
   * `redirect_url` rides along so the page has no reason to call
   * `/questions/results` as well; this endpoint answers both questions.
   */
  async getQuizReport(quizId: string): Promise<{
    redirect_url: FunnelRedirect;
    quiz: {
      quiz_id: string;
      iq_score: number | null;
      category_scores: Record<string, number> | null;
      language: string;
      duration_seconds: number | null;
      completed_at: Date;
    };
    customer: {
      email: string;
      first_name: string | null;
      last_name: string | null;
      age: string | null;
      gender: string | null;
      /**
       * The Personal Detail page must ask for an email address. True while the
       * attempt is still on its placeholder — after a wallet payment, which
       * settles before we know who paid. A card payment brings its address
       * with it, so this is false by the time a card payer gets here.
       */
      email_required: boolean;
      /**
       * What to pre-fill that field with: the address the wallet handed over,
       * held back until the customer either confirms it, types another, or
       * leaves it to the replacement job. Null when there is none.
       */
      suggested_email: string | null;
    };
    report: {
      first_sale_paid: boolean;
      cross_sale_paid: boolean;
    };
  }> {
    let numericId: string;
    try {
      numericId = EncryptionUtil.decryptId(quizId);
    } catch {
      throw new AppError('Invalid quiz_id', 400);
    }

    // `transactions` must be loaded: without it every sale reads as unpaid,
    // and both the flags below and resolveFunnelRedirect would be wrong.
    const result = await this.quizResultRepository.findOne({
      where: { id: numericId },
      relations: ['transactions']
    });

    if (!result) {
      throw new AppError('Quiz result not found', 404);
    }

    const hasPaid = (type: string): boolean =>
      result.transactions?.some(
        (tx) => tx.transaction_type === type && tx.status === 'succeeded'
      ) ?? false;

    return {
      redirect_url: resolveFunnelRedirect(result),
      quiz: {
        // Re-encrypted on every read, so this differs each call by design.
        quiz_id: EncryptionUtil.encryptId(result.id),
        iq_score: result.iq_score,
        // The instrument's own subtests, stored exactly as submitted.
        category_scores: result.category_scores,
        language: result.language,
        duration_seconds: result.duration_seconds,
        completed_at: result.created_at
      },
      customer: {
        email: isPlaceholderEmail(result.email) ? '' : result.email,
        first_name: result.first_name,
        last_name: result.last_name,
        age: result.age,
        gender: result.gender,
        email_required: isPlaceholderEmail(result.email),
        suggested_email: isPlaceholderEmail(result.email) ? result.pending_email : null
      },
      report: {
        first_sale_paid: hasPaid('first_sale'),
        cross_sale_paid: hasPaid('cross_sale')
      }
    };
  }
}

export const quizService = new QuizService();
