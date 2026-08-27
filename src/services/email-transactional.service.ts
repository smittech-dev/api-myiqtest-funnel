import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { EmailTransactionalLog } from '../entities/EmailTransactionalLog.entity.js';
import { createEmailContext, honorific } from '../emails/context.js';
import type { EmailLanguage, EmailTemplateContext } from '../emails/email.types.js';
import { emailService } from './email.service.js';
import { generateCustomerPassword } from '../utils/customer-password.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { logger } from '../utils/logger.util.js';
import { PasswordUtil } from '../utils/password.util.js';

/**
 * The two emails a paying customer receives.
 *
 * Both are **fire-and-forget from the caller's point of view**. A payment must
 * not fail because ZeptoMail was slow, and a Stripe webhook must not time out
 * waiting for an email, so every entry point here catches everything and
 * resolves to a result rather than throwing. The caller uses `void`.
 *
 * Both are also **claimed before they are sent**: a row goes into
 * `email_transactional_logs` with a unique `dedup_key` first, so the confirm
 * endpoint and the webhook arriving for the same payment produce one email and
 * one no-op. Same pattern as the marketing runner, same reason — a
 * check-then-send would race.
 */

export type TransactionalSendResult =
  | { status: 'sent'; messageId: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/** Everything a send needs, resolved from the quiz result in one query. */
interface Recipient {
  quizResult: CustomerQuizResult;
  customer: Customer | null;
  language: EmailLanguage;
}

export class EmailTransactionalService {
  private logRepository = AppDataSource.getRepository(EmailTransactionalLog);
  private quizRepository = AppDataSource.getRepository(CustomerQuizResult);
  private customerRepository = AppDataSource.getRepository(Customer);

  // -------------------------------------------------------------------------
  // 1. Welcome — the first sale settled
  // -------------------------------------------------------------------------

  /**
   * Send the welcome email with the customer's brain training credentials.
   *
   * Issues a real password the first time, hashes it with bcrypt into
   * `customers.password_hash`, and stamps `password_set_at`. The plaintext lives
   * only long enough to be rendered into this one message — it is never stored
   * and never recoverable, so a customer who loses the email needs a reset
   * rather than a lookup.
   *
   * A returning customer who already has a password keeps it: the email still
   * goes out, but with a note instead of new credentials. Silently rotating the
   * password someone is already using, because they bought a second report,
   * would be a worse outcome than not sending credentials at all.
   */
  async sendWelcome(quizResultId: string): Promise<TransactionalSendResult> {
    return this.guard('welcome', quizResultId, async () => {
      const recipient = await this.resolveRecipient(quizResultId);
      if (!recipient) return { skip: 'quiz result not found' };

      const { quizResult, customer, language } = recipient;

      if (!customer) {
        // Credentials are the point of this email, and they belong to a
        // customer record. Without one there is nothing to send.
        return { skip: 'quiz result has no customer account' };
      }

      // Issue the password *before* the claim is spent, so a provider failure
      // leaves the account with a working password and a retryable email rather
      // than an account nobody can sign in to.
      const password = await this.ensurePassword(customer);

      const loginUrl = config.brainTraining.loginUrl || this.siteUrl();
      if (!config.brainTraining.loginUrl) {
        logger.warn(
          'BRAIN_TRAINING_LOGIN_URL is not set — the welcome email points at the funnel instead.'
        );
      }

      return {
        templateId: 'transactional_welcome',
        customerId: customer.id,
        email: customer.email,
        language,
        context: this.baseContext(quizResult, customer.email, language, {
          login_email: customer.email,
          login_password: password,
          login_url: loginUrl,
          program_name: config.brainTraining.name
        })
      };
    });
  }

  // -------------------------------------------------------------------------
  // 2. Report ready — the customer finished the funnel
  // -------------------------------------------------------------------------

  /**
   * Send the report-ready email.
   *
   * Carries one button per report the customer actually owns: the first-sale
   * report always, the cross-sale report only when that upsell was paid. The
   * entitlement is read from succeeded transactions rather than passed in, so
   * the email cannot offer a document the customer has not bought.
   */
  async sendReportReady(quizResultId: string): Promise<TransactionalSendResult> {
    return this.guard('report_ready', quizResultId, async () => {
      const recipient = await this.resolveRecipient(quizResultId, { withTransactions: true });
      if (!recipient) return { skip: 'quiz result not found' };

      const { quizResult, customer, language } = recipient;

      const paid = (type: string) =>
        quizResult.transactions?.some(
          (tx) => tx.transaction_type === type && tx.status === 'succeeded'
        ) ?? false;

      if (!paid('first_sale')) {
        // There is no report without the first sale. Reachable if the funnel
        // ever saves details before payment settles.
        return { skip: 'first sale is not paid' };
      }

      return {
        templateId: 'transactional_report_ready',
        customerId: customer?.id ?? null,
        email: quizResult.email,
        language,
        context: this.baseContext(quizResult, quizResult.email, language, {
          first_sale_report_url: this.reportUrl(quizResult, 'first_sale'),
          // Null when the upsell was not bought — which is what removes the
          // second button from the design.
          cross_sale_report_url: paid('cross_sale')
            ? this.reportUrl(quizResult, 'cross_sale')
            : null
        })
      };
    });
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /**
   * The shared path: check the switch, claim the key, build the message, send,
   * record. Swallows everything.
   *
   * `build` returns either a `skip` reason or the message to send, so the
   * per-email logic above stays declarative and never touches the log table.
   */
  private async guard(
    kind: 'welcome' | 'report_ready',
    quizResultId: string,
    build: () => Promise<
      | { skip: string }
      | {
          templateId: string;
          customerId: string | null;
          email: string;
          language: EmailLanguage;
          context: EmailTemplateContext;
        }
    >
  ): Promise<TransactionalSendResult> {
    const dedupKey = `${kind}:${quizResultId}`;

    try {
      if (!config.transactionalEmail.enabled) {
        return { status: 'skipped', reason: 'TRANSACTIONAL_EMAIL_ENABLED=false' };
      }

      const problem = emailService.configurationProblem();
      if (problem || !config.email.enabled) {
        // Checked before the claim: a missing token is an operator problem, not
        // this customer's, and must not burn their one dedup key.
        logger.warn(
          `Transactional email ${dedupKey} skipped — ${problem ?? 'ZEPTOMAIL_ENABLED=false'}.`
        );
        return {
          status: 'skipped',
          reason: problem ?? 'email sending is disabled (ZEPTOMAIL_ENABLED=false)'
        };
      }

      const built = await build();
      if ('skip' in built) {
        logger.info(`Transactional email ${dedupKey} skipped — ${built.skip}.`);
        return { status: 'skipped', reason: built.skip };
      }

      const claim = await this.claim(dedupKey, quizResultId, built);
      if (!claim) {
        // Already sent, already being sent by the other trigger, or retried out.
        return { status: 'skipped', reason: 'already sent or in flight' };
      }

      const result = await emailService.send({
        templateId: built.templateId,
        to: built.email,
        toName: built.context.first_name,
        context: built.context
      });

      if (result.status === 'sent') {
        await this.logRepository.update(claim.id, {
          status: 'sent',
          provider_message_id: result.messageId,
          error_message: null,
          attempts: claim.attempts + 1,
          sent_at: new Date()
        });
        logger.info(`Transactional email ${dedupKey} sent to ${built.email}.`);
        return { status: 'sent', messageId: result.messageId };
      }

      const error = result.status === 'failed' ? result.error : result.reason;
      await this.logRepository.update(claim.id, {
        status: 'failed',
        error_message: error.slice(0, 1000),
        // A transport that was switched off mid-flight is not this customer's
        // fault, so it does not consume an attempt.
        attempts: result.status === 'failed' ? claim.attempts + 1 : claim.attempts
      });
      logger.error(`Transactional email ${dedupKey} failed: ${error}`);
      return { status: 'failed', error };
    } catch (err: any) {
      // The whole point of this class: nothing that happens in here may reach
      // the payment or the funnel request that triggered it.
      logger.error(`Transactional email ${dedupKey} threw: ${err?.message ?? err}`);
      return { status: 'failed', error: err?.message ?? 'unknown error' };
    }
  }

  /**
   * Take ownership of a dedup key before the provider is called.
   *
   * `orIgnore()` compiles to `ON CONFLICT DO NOTHING`, so two triggers racing on
   * the same payment produce one insert and one no-op — the database picks the
   * winner. Returns the claimed row, or null when someone else holds it or it
   * has already been sent.
   */
  private async claim(
    dedupKey: string,
    quizResultId: string,
    built: { templateId: string; customerId: string | null; email: string; language: EmailLanguage }
  ): Promise<EmailTransactionalLog | null> {
    const inserted = await this.logRepository
      .createQueryBuilder()
      .insert()
      .values({
        dedup_key: dedupKey,
        customer_id: built.customerId,
        customer_quiz_result_id: quizResultId,
        email: built.email,
        template_id: built.templateId,
        language: built.language,
        status: 'pending',
        attempts: 0
      })
      .orIgnore()
      .execute();

    if (inserted.identifiers.length > 0 && inserted.identifiers[0]?.id) {
      return this.logRepository.findOne({ where: { id: String(inserted.identifiers[0].id) } });
    }

    // The key already exists. Retry only a previous failure that still has
    // attempts left; a 'sent' or in-flight 'pending' row is left alone.
    const retake = await this.logRepository
      .createQueryBuilder()
      .update(EmailTransactionalLog)
      .set({ status: 'pending', error_message: null })
      .where('dedup_key = :dedupKey', { dedupKey })
      .andWhere('status = :status', { status: 'failed' })
      .andWhere('attempts < :maxAttempts', {
        maxAttempts: config.transactionalEmail.maxAttempts
      })
      .returning('id')
      .execute();

    const retakenId = retake.raw?.[0]?.id;
    if (!retakenId) return null;

    return this.logRepository.findOne({ where: { id: String(retakenId) } });
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  private siteUrl(): string {
    return config.frontendUrl.replace(/\/+$/, '');
  }

  private async resolveRecipient(
    quizResultId: string,
    opts: { withTransactions?: boolean } = {}
  ): Promise<Recipient | null> {
    const quizResult = await this.quizRepository.findOne({
      where: { id: quizResultId },
      relations: opts.withTransactions ? ['transactions'] : []
    });

    if (!quizResult) return null;

    const customer = quizResult.customer_id
      ? await this.customerRepository.findOne({ where: { id: quizResult.customer_id } })
      : null;

    return {
      quizResult,
      customer,
      language: quizResult.language?.toLowerCase() === 'en' ? 'en' : 'ja'
    };
  }

  /**
   * Issues a password if this account has never had one, and returns the
   * plaintext to be emailed. Returns null when the customer already has one,
   * which is the design's signal to send the "your existing password still
   * works" note instead of a credential.
   */
  private async ensurePassword(customer: Customer): Promise<string | null> {
    if (customer.password_set_at) {
      return null;
    }

    const password = generateCustomerPassword();
    customer.password_hash = await PasswordUtil.hash(password);
    customer.password_set_at = new Date();
    await this.customerRepository.save(customer);

    logger.info(`Issued brain training credentials for customer ${customer.id}.`);
    return password;
  }

  /**
   * Where a report opens.
   *
   * Prefers a stored file from `customer_quiz_results.report_urls` — the column
   * exists for generated PDFs — and falls back to the funnel page that renders
   * the report live. That ordering means the day PDF generation is added, these
   * emails start linking to the files with no change here.
   *
   * The encrypted quiz id rides the query string either way: the report pages
   * are session-guarded, and a link opened days later in a different browser has
   * no session to restore from.
   */
  private reportUrl(quizResult: CustomerQuizResult, type: 'first_sale' | 'cross_sale'): string {
    const stored = quizResult.report_urls ?? {};

    const storedUrl =
      type === 'first_sale'
        ? (stored.report_pdf_url ?? stored.certificate_url)
        : stored.career_report_url;

    if (typeof storedUrl === 'string' && storedUrl.trim()) {
      return storedUrl.trim();
    }

    const language = quizResult.language?.toLowerCase() === 'en' ? 'en' : 'ja';
    // `/result` carries the certificate and the detailed report; `/result/report`
    // is the career and aptitude document the cross-sale unlocks.
    const path = type === 'first_sale' ? 'result' : 'result/report';

    const url = new URL(`${this.siteUrl()}/${language}/${path}`);
    url.searchParams.set('quiz_id', EncryptionUtil.encryptId(quizResult.id));
    return url.toString();
  }

  /** The context every transactional design starts from. */
  private baseContext(
    quizResult: CustomerQuizResult,
    email: string,
    language: EmailLanguage,
    overrides: Partial<EmailTemplateContext>
  ): EmailTemplateContext {
    return createEmailContext(
      { email, language, site_url: this.siteUrl() },
      {
        first_name: quizResult.first_name,
        honorific_name: honorific(language, quizResult.first_name),
        iq_score: quizResult.iq_score,
        ...overrides
      }
    );
  }
}

export const emailTransactionalService = new EmailTransactionalService();
