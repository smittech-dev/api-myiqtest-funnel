import crypto from 'crypto';
import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { Customer } from '../entities/Customer.entity.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { QuizSubmitPayload } from '../types/quiz.types.js';
import { resolveFunnelRedirect, FunnelRedirect } from '../utils/funnel-redirect.util.js';
import { emailVerificationService } from './email-verification.service.js';
import { config } from '../config/env.config.js';
import { logger } from '../utils/logger.util.js';

export class QuizService {
  private quizResultRepository = AppDataSource.getRepository(CustomerQuizResult);
  private customerRepository = AppDataSource.getRepository(Customer);

  /**
   * Submit quiz with pre-calculated iq_score and 4 category scores from frontend
   */
  async submitQuiz(payload: QuizSubmitPayload, ipAddress?: string): Promise<{
    quiz_id: string;
  }> {
    const {
      email,
      iq_score,
      category_scores,
      duration_seconds,
      language = 'ja',
      landing_url_details
    } = payload;

    // 1. Find or create Customer with inactive status and temporary password hash
    let customer = await this.customerRepository.findOne({ where: { email } });
    if (!customer) {
      const tempPassword = crypto.randomBytes(16).toString('hex');
      const passwordHash = crypto.createHash('sha256').update(tempPassword).digest('hex');

      customer = this.customerRepository.create({
        email,
        password_hash: passwordHash,
        status: 'inactive' // Customer cannot log in until activated
      });
      await this.customerRepository.save(customer);
    }

    // 1b. Verify the address with Reoon the first time we see it. Best-effort: a
    // provider outage must not stop someone submitting, and an already-verified
    // customer is not re-checked (each call costs a credit).
    await this.verifyCustomerEmail(customer);

    // 2. Create Quiz Result entry
    const quizResult = this.quizResultRepository.create({
      customer_id: customer.id,
      email,
      iq_score: Math.round(iq_score),
      category_scores: category_scores || null,
      duration_seconds: duration_seconds || null,
      language: language.toLowerCase() === 'en' ? 'en' : 'ja',
      ip_address: ipAddress || null,
      country_code: language.toLowerCase() === 'ja' ? 'JP' : 'US',
      landing_url_details: landing_url_details || null,
      report_urls: null
    });

    const savedResult = await this.quizResultRepository.save(quizResult);

    // 3. Encrypt the database quiz result ID
    const encryptedQuizId = EncryptionUtil.encryptId(savedResult.id);

    return {
      quiz_id: encryptedQuizId
    };
  }

  /**
   * Run email verification and persist the outcome. Swallows every failure.
   */
  private async verifyCustomerEmail(customer: Customer): Promise<void> {
    if (!config.emailVerification.enabled || customer.email_verified) {
      return;
    }

    try {
      const result = await emailVerificationService.verify(customer.email);

      if (result.verified !== customer.email_verified) {
        customer.email_verified = result.verified;
        await this.customerRepository.save(customer);
      }
    } catch (err: any) {
      // The service already guards itself; this is a last resort so a storage
      // problem here can never fail the quiz submission.
      logger.error(`Email verification step failed for ${customer.email}: ${err.message}`);
    }
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
        email: result.email,
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
        email: result.email,
        first_name: result.first_name,
        last_name: result.last_name,
        age: result.age,
        gender: result.gender
      },
      report: {
        first_sale_paid: hasPaid('first_sale'),
        cross_sale_paid: hasPaid('cross_sale')
      }
    };
  }
}

export const quizService = new QuizService();
