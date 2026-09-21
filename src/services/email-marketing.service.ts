import { AppDataSource } from '../config/database.config.js';
import { discountCodes } from '../config/discount-codes.config.js';
import {
  emailMarketingSettingsService,
  enabledStepsInOrder,
  type EmailMarketingConfig,
  type EmailMarketingStep
} from './email-marketing-settings.service.js';
import { config } from '../config/env.config.js';
import { EmailMarketingLog } from '../entities/EmailMarketingLog.entity.js';
import { createEmailContext, honorific } from '../emails/context.js';
import type { EmailLanguage, EmailTemplateContext } from '../emails/email.types.js';
import { getTemplate } from '../emails/registry.js';
import { emailService } from './email.service.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { logger } from '../utils/logger.util.js';
import type {
  AdminEmailMarketingLogItem,
  AdminEmailMarketingLogQuery,
  AdminEmailMarketingStats,
  AdminPaginatedResult,
  DateRangeFilter
} from '../types/admin.types.js';

/**
 * The abandoned-checkout sequence.
 *
 * Every five minutes: find people who took the quiz, whose address verified,
 * who never paid for the first sale, work out which rung of the discount ladder
 * they are due, and send exactly that one.
 *
 * Two rules do most of the work here, and both are worth stating plainly.
 *
 * **One person, one step, ever.** The unique index on
 * `(customer_id, step_key)` is the guarantee, and the runner claims a step by
 * *inserting* that row before it calls the provider. A check-then-send would
 * race two ticks against each other and double-send; an insert cannot.
 *
 * **The ladder is caught up to, not walked through.** When several steps are
 * due at once — the sequence was off, the server was down, the quiz predates
 * the feature — the runner sends the *latest* due step and marks the earlier
 * ones skipped. Someone four days past their quiz gets the 50% email today,
 * not the 20% email today and the rest over the next fifteen minutes.
 */

/** One unconverted lead, as the candidate query returns it. */
interface Candidate {
  quiz_id: string;
  customer_id: string;
  email: string;
  first_name: string | null;
  language: string;
  iq_score: number | null;
  created_at: Date;
}

export interface EmailMarketingRunResult {
  candidates: number;
  sent: number;
  failed: number;
  /** Steps retired without sending because a later rung was already due. */
  superseded: number;
  /** Candidates the runner looked at but had nothing due for. */
  nothing_due: number;
  duration_ms: number;
}

export class EmailMarketingService {
  private logRepository = AppDataSource.getRepository(EmailMarketingLog);

  // -------------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------------

  /**
   * One pass of the sequence. Called by the cron and by the admin's "Run now".
   *
   * Sends are sequential rather than parallel: the batch is small, ZeptoMail
   * rate-limits per account, and a run that finishes in twenty seconds instead
   * of four buys nothing when the next tick is five minutes away.
   */
  async runOnce(): Promise<EmailMarketingRunResult> {
    const startedAt = Date.now();
    const settings = await emailMarketingSettingsService.getConfig();
    const steps = enabledStepsInOrder(settings);

    const empty: EmailMarketingRunResult = {
      candidates: 0,
      sent: 0,
      failed: 0,
      superseded: 0,
      nothing_due: 0,
      duration_ms: 0
    };

    if (!settings.enabled) {
      logger.info('Email marketing run skipped — the sequence is disabled in the admin config.');
      return { ...empty, duration_ms: Date.now() - startedAt };
    }

    if (steps.length === 0) {
      logger.warn('Email marketing run skipped — no steps are enabled.');
      return { ...empty, duration_ms: Date.now() - startedAt };
    }

    // Checked before any candidate is claimed. Without this, a run with the
    // mail credentials missing would stamp a failed row on every eligible
    // customer — filling the tracking table with rows that say nothing about
    // those customers, and burying the real failures once sending does start.
    const transportProblem = emailService.configurationProblem();
    if (transportProblem || !config.email.enabled) {
      logger.warn(
        `Email marketing run skipped — ${transportProblem ?? 'email sending is disabled (ZEPTOMAIL_ENABLED=false)'}.`
      );
      return { ...empty, duration_ms: Date.now() - startedAt };
    }

    const candidates = await this.findCandidates(settings, steps);
    const result: EmailMarketingRunResult = { ...empty, candidates: candidates.length };

    for (const candidate of candidates) {
      const outcome = await this.processCandidate(candidate, settings, steps);
      result.sent += outcome.sent;
      result.failed += outcome.failed;
      result.superseded += outcome.superseded;
      if (outcome.sent === 0 && outcome.failed === 0) {
        result.nothing_due += 1;
      }
    }

    result.duration_ms = Date.now() - startedAt;

    logger.info(
      `Email marketing run: ${result.candidates} candidate(s), ${result.sent} sent, ` +
        `${result.failed} failed, ${result.superseded} superseded (${result.duration_ms}ms)`
    );

    return result;
  }

  /**
   * The people the sequence may contact right now.
   *
   * `DISTINCT ON (customer_id)` collapses repeat quiz-takers to their most
   * recent submission — the sequence is addressed to a person, not to a
   * submission, so someone who took the test three times is one candidate timed
   * from their latest attempt.
   *
   * The "already paid" test walks transactions through the quiz results rather
   * than through `transactions.customer_id`, which is nullable: the quiz link is
   * the one that is always populated, so it is the one that can be trusted to
   * keep a paying customer out of the list.
   *
   * The final count subquery drops anyone who has already been through every
   * enabled step, so a long-lived table does not grow the per-tick workload.
   */
  private async findCandidates(
    settings: EmailMarketingConfig,
    steps: EmailMarketingStep[]
  ): Promise<Candidate[]> {
    const minDelayHours = steps[0].delay_hours;
    const stepKeys = steps.map((s) => s.key);

    const rows = await AppDataSource.query(
      `
      SELECT * FROM (
        SELECT DISTINCT ON (q.customer_id)
          q.id            AS quiz_id,
          q.customer_id   AS customer_id,
          q.email         AS email,
          q.first_name    AS first_name,
          q.language      AS language,
          q.iq_score      AS iq_score,
          q.created_at    AS created_at
        FROM customer_quiz_results q
        JOIN customers c ON c.id = q.customer_id
        WHERE q.customer_id IS NOT NULL
          AND c.email_verified = TRUE
          AND q.created_at <= NOW() - ($1 * INTERVAL '1 hour')
          AND q.created_at >= NOW() - ($2 * INTERVAL '1 hour')
          AND NOT EXISTS (
            SELECT 1
            FROM customer_quiz_result_payment_transactions t
            JOIN customer_quiz_results q2 ON q2.id = t.customer_quiz_result_id
            WHERE q2.customer_id = q.customer_id
              AND t.transaction_type = 'first_sale'
              AND t.status = 'succeeded'
          )
          AND (
            SELECT COUNT(*)
            FROM email_marketing_logs l
            WHERE l.customer_id = q.customer_id
              AND l.step_key = ANY($3)
              AND l.status IN ('sent', 'skipped')
          ) < $4
        ORDER BY q.customer_id, q.created_at DESC
      ) s
      ORDER BY s.created_at ASC
      LIMIT $5
      `,
      [minDelayHours, settings.max_age_hours, stepKeys, stepKeys.length, settings.batch_size]
    );

    return rows.map((row: any) => ({
      quiz_id: String(row.quiz_id),
      customer_id: String(row.customer_id),
      email: row.email,
      first_name: row.first_name,
      language: row.language,
      iq_score: row.iq_score === null ? null : Number(row.iq_score),
      created_at: new Date(row.created_at)
    }));
  }

  /** Works out which step one candidate is due, and sends it. */
  private async processCandidate(
    candidate: Candidate,
    settings: EmailMarketingConfig,
    steps: EmailMarketingStep[]
  ): Promise<{ sent: number; failed: number; superseded: number }> {
    const idle = { sent: 0, failed: 0, superseded: 0 };

    const elapsedHours = (Date.now() - candidate.created_at.getTime()) / 3_600_000;
    const dueSteps = steps.filter((step) => elapsedHours >= step.delay_hours);
    if (dueSteps.length === 0) return idle;

    const history = await this.logRepository.find({
      where: { customer_id: candidate.customer_id }
    });
    const byStep = new Map(history.map((row) => [row.step_key, row]));

    const stuckBefore = new Date(Date.now() - config.emailMarketing.stuckClaimMinutes * 60_000);

    const outstanding = dueSteps.filter((step) => {
      const row = byStep.get(step.key);
      if (!row) return true;
      if (row.status === 'sent' || row.status === 'skipped') return false;
      if (row.status === 'failed') return row.attempts < settings.max_attempts;
      // 'pending' — claimed by a runner. Only reclaim it once that runner has
      // plainly died, otherwise two ticks would send the same email.
      return row.updated_at < stuckBefore;
    });

    if (outstanding.length === 0) return idle;

    // The latest due rung wins; the rest are retired. See the class comment.
    const target = outstanding[outstanding.length - 1];
    const superseded = outstanding.slice(0, -1);

    let supersededCount = 0;
    for (const step of superseded) {
      const retired = await this.retireStep(candidate, step, `superseded by ${target.key}`);
      if (retired) supersededCount += 1;
    }

    const claimed = await this.claimStep(candidate, target, settings, stuckBefore);
    if (!claimed) {
      // Another runner took it between the read above and now. Correct outcome,
      // not an error: exactly one of us will send it.
      return { ...idle, superseded: supersededCount };
    }

    const sent = await this.sendStep(candidate, target, claimed);

    return {
      sent: sent ? 1 : 0,
      failed: sent ? 0 : 1,
      superseded: supersededCount
    };
  }

  /**
   * Marks a step as deliberately never sent.
   *
   * Writes the same row the sender would have written, so the customer's
   * history reads as a complete ladder and the candidate query's "have they
   * finished the sequence" count stays correct.
   */
  private async retireStep(
    candidate: Candidate,
    step: EmailMarketingStep,
    reason: string
  ): Promise<boolean> {
    const existing = await this.logRepository.findOne({
      where: { customer_id: candidate.customer_id, step_key: step.key }
    });

    if (existing) {
      if (existing.status === 'sent' || existing.status === 'skipped') return false;
      await this.logRepository.update(existing.id, { status: 'skipped', skip_reason: reason });
      return true;
    }

    await this.logRepository
      .createQueryBuilder()
      .insert()
      .values({
        customer_id: candidate.customer_id,
        customer_quiz_result_id: candidate.quiz_id,
        email: candidate.email,
        step_key: step.key,
        template_id: step.template_id,
        discount_code: step.discount_code || null,
        language: this.languageOf(candidate),
        status: 'skipped',
        skip_reason: reason
      })
      .orIgnore()
      .execute();

    return true;
  }

  /**
   * Takes ownership of a step before the provider is called.
   *
   * `orIgnore()` compiles to `ON CONFLICT DO NOTHING`, so two runners racing on
   * the same (customer, step) produce one insert and one no-op — the database
   * decides the winner, and the loser walks away rather than sending a
   * duplicate. Returns the claimed row, or null if someone else holds it.
   */
  private async claimStep(
    candidate: Candidate,
    step: EmailMarketingStep,
    settings: EmailMarketingConfig,
    stuckBefore: Date
  ): Promise<EmailMarketingLog | null> {
    const inserted = await this.logRepository
      .createQueryBuilder()
      .insert()
      .values({
        customer_id: candidate.customer_id,
        customer_quiz_result_id: candidate.quiz_id,
        email: candidate.email,
        step_key: step.key,
        template_id: step.template_id,
        discount_code: step.discount_code || null,
        language: this.languageOf(candidate),
        status: 'pending',
        attempts: 0
      })
      .orIgnore()
      .execute();

    if (inserted.identifiers.length > 0 && inserted.identifiers[0]?.id) {
      return this.logRepository.findOne({ where: { id: String(inserted.identifiers[0].id) } });
    }

    // The row already existed — a retry of a failed send, or a claim abandoned
    // by a dead runner. Re-take it with a conditional UPDATE so the transition
    // is atomic against another tick doing the same.
    const retake = await this.logRepository
      .createQueryBuilder()
      .update(EmailMarketingLog)
      .set({
        status: 'pending',
        template_id: step.template_id,
        discount_code: step.discount_code || null,
        error_message: null
      })
      .where('customer_id = :customerId', { customerId: candidate.customer_id })
      .andWhere('step_key = :stepKey', { stepKey: step.key })
      .andWhere(
        "(status = 'failed' AND attempts < :maxAttempts) OR (status = 'pending' AND updated_at < :stuckBefore)",
        { maxAttempts: settings.max_attempts, stuckBefore }
      )
      .returning('id')
      .execute();

    const retakenId = retake.raw?.[0]?.id;
    if (!retakenId) return null;

    return this.logRepository.findOne({ where: { id: String(retakenId) } });
  }

  /** Renders, sends, and records the outcome on the claimed row. */
  private async sendStep(
    candidate: Candidate,
    step: EmailMarketingStep,
    claim: EmailMarketingLog
  ): Promise<boolean> {
    const context = this.buildContext(candidate, step);

    const result = await emailService.send({
      templateId: step.template_id,
      to: candidate.email,
      toName: candidate.first_name,
      context
    });

    if (result.status === 'sent') {
      await this.logRepository.update(claim.id, {
        status: 'sent',
        provider_message_id: result.messageId,
        error_message: null,
        attempts: claim.attempts + 1,
        sent_at: new Date()
      });
      return true;
    }

    if (result.status === 'skipped') {
      // The transport is off or unconfigured. Release the claim rather than
      // burning an attempt — nothing was wrong with this customer, and the step
      // should fire normally once the credentials are in place.
      await this.logRepository.update(claim.id, {
        status: 'failed',
        error_message: result.reason,
        attempts: claim.attempts
      });
      return false;
    }

    await this.logRepository.update(claim.id, {
      status: 'failed',
      error_message: result.error.slice(0, 1000),
      attempts: claim.attempts + 1
    });
    return false;
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  private languageOf(candidate: Candidate): EmailLanguage {
    return candidate.language?.toLowerCase() === 'en' ? 'en' : 'ja';
  }

  /**
   * The dynamic parameters one email is rendered from.
   *
   * The CTA is the point of the whole message: it carries the encrypted quiz id
   * so the funnel restores the customer's session, and the discount code as
   * `price_dis` so the price they are quoted already has the discount in it.
   * The funnel reads both from the query string — see src/funnel/redirect.ts on
   * the frontend — so the customer lands on checkout with nothing to type.
   */
  private buildContext(candidate: Candidate, step: EmailMarketingStep): EmailTemplateContext {
    const language = this.languageOf(candidate);
    const code = step.discount_code ? step.discount_code.toUpperCase() : null;
    const percent = code ? (discountCodes[code]?.discount ?? null) : null;
    const siteUrl = config.funnelUrl;

    const ctaUrl = new URL(`${siteUrl}/${language}/checkout`);
    ctaUrl.searchParams.set('quiz_id', EncryptionUtil.encryptId(candidate.quiz_id));
    if (code) ctaUrl.searchParams.set('price_dis', code);

    return createEmailContext(
      { email: candidate.email, language, site_url: siteUrl },
      {
        first_name: candidate.first_name,
        honorific_name: honorific(language, candidate.first_name),
        iq_score: candidate.iq_score,
        discount_code: code,
        discount_percent: percent,
        cta_url: ctaUrl.toString(),
        hours_since_quiz: Math.floor((Date.now() - candidate.created_at.getTime()) / 3_600_000)
      }
    );
  }

  /** The least valuable real code, used to dress a preview. Null if none exist. */
  private smallestDiscountCode(): string | null {
    const codes = Object.values(discountCodes);
    if (codes.length === 0) return null;
    return codes.reduce((min, entry) => (entry.discount < min.discount ? entry : min)).code;
  }

  // -------------------------------------------------------------------------
  // Admin reads
  // -------------------------------------------------------------------------

  /**
   * Sends one template to a chosen address with placeholder data, so an
   * operator can see a design in their own inbox before it goes to customers.
   *
   * Deliberately writes no tracking row: this is not a step, and it must not
   * consume the recipient's place in the sequence.
   *
   * A code is always attached — the caller's, or the smallest real one — because
   * these designs write the discount into their copy, and a preview with no code
   * would show "%OFF" rather than the email a customer would actually receive.
   */
  async sendTest(input: {
    templateId: string;
    to: string;
    language: EmailLanguage;
    discountCode?: string | null;
  }): Promise<{ subject: string; message_id: string | null }> {
    const template = getTemplate(input.templateId);
    if (!template) {
      throw new AppError(`Unknown email template "${input.templateId}".`, 400);
    }

    const problem = emailService.configurationProblem();
    if (problem) {
      throw new AppError(problem, 500);
    }

    const code = input.discountCode
      ? input.discountCode.toUpperCase()
      : (this.smallestDiscountCode() ?? null);
    const percent = code ? (discountCodes[code]?.discount ?? null) : null;
    const siteUrl = config.funnelUrl;

    const ctaUrl = new URL(`${siteUrl}/${input.language}/checkout`);
    // A sample id, not a real session: the link proves the design, and must not
    // hand whoever receives the test a working checkout for someone else's quiz.
    ctaUrl.searchParams.set('quiz_id', EncryptionUtil.encryptId('0'));
    if (code) ctaUrl.searchParams.set('price_dis', code);

    const sampleName = input.language === 'ja' ? 'テスト' : 'Alex';

    const result = await emailService.send({
      templateId: input.templateId,
      to: input.to,
      toName: null,
      // Every parameter any template might declare is filled with a sample, so
      // one endpoint can preview a marketing nudge and a transactional receipt
      // alike. The password is visibly fake — a preview must never be mistaken
      // for a real credential.
      context: createEmailContext(
        { email: input.to, language: input.language, site_url: siteUrl },
        {
          first_name: sampleName,
          honorific_name: honorific(input.language, sampleName),
          iq_score: 124,
          discount_code: code,
          discount_percent: percent,
          cta_url: ctaUrl.toString(),
          hours_since_quiz: 24,
          login_email: input.to,
          login_password: 'SAMP-LE00-TEST',
          login_url: config.brainTraining.loginUrl || siteUrl,
          program_name: config.brainTraining.name,
          first_sale_report_url: `${siteUrl}/${input.language}/result?quiz_id=sample`,
          cross_sale_report_url: `${siteUrl}/${input.language}/result/report?quiz_id=sample`
        }
      )
    });

    if (result.status === 'failed') {
      throw new AppError(result.error, 502);
    }
    if (result.status === 'skipped') {
      throw new AppError(result.reason, 409);
    }

    return { subject: result.subject, message_id: result.messageId };
  }

  /** Counts per step and per status, for the admin summary tiles. */
  async getStats(range: DateRangeFilter = {}): Promise<AdminEmailMarketingStats> {
    const qb = this.logRepository
      .createQueryBuilder('log')
      .select('log.step_key', 'step_key')
      .addSelect('log.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.step_key')
      .addGroupBy('log.status');

    if (range.from) qb.andWhere('log.created_at >= :from', { from: range.from });
    if (range.to) qb.andWhere('log.created_at <= :to', { to: range.to });

    const rows: Array<{ step_key: string; status: string; count: string }> = await qb.getRawMany();

    const byStep: Record<string, { sent: number; failed: number; skipped: number; pending: number }> =
      {};
    const totals = { sent: 0, failed: 0, skipped: 0, pending: 0 };

    for (const row of rows) {
      const count = Number(row.count);
      const bucket = (byStep[row.step_key] ??= { sent: 0, failed: 0, skipped: 0, pending: 0 });

      if (row.status in bucket) {
        bucket[row.status as keyof typeof bucket] += count;
        totals[row.status as keyof typeof totals] += count;
      }
    }

    return { totals, by_step: byStep };
  }

  /** Paginated send log for the admin activity table, newest first. */
  async listLogs(
    query: AdminEmailMarketingLogQuery
  ): Promise<AdminPaginatedResult<AdminEmailMarketingLogItem>> {
    const { page, page_size, step_key, status, search, from, to } = query;

    const qb = this.logRepository.createQueryBuilder('log');

    if (from) qb.andWhere('log.created_at >= :from', { from });
    if (to) qb.andWhere('log.created_at <= :to', { to });
    if (step_key && step_key !== 'all') qb.andWhere('log.step_key = :stepKey', { stepKey: step_key });
    if (status && status !== 'all') qb.andWhere('log.status = :status', { status });
    if (search?.trim()) {
      qb.andWhere('log.email ILIKE :term', { term: `%${search.trim()}%` });
    }

    qb.orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((page - 1) * page_size)
      .take(page_size);

    const [rows, total] = await qb.getManyAndCount();

    return {
      items: rows.map((row) => ({
        id: row.id,
        customer_id: row.customer_id,
        customer_quiz_result_id: row.customer_quiz_result_id,
        email: row.email,
        step_key: row.step_key,
        template_id: row.template_id,
        // Resolved for display only; the id is what the row actually stores, so
        // a template deleted from the master still shows its id rather than
        // breaking the table.
        template_name: getTemplate(row.template_id)?.name ?? row.template_id,
        discount_code: row.discount_code,
        language: row.language,
        status: row.status,
        provider_message_id: row.provider_message_id,
        error_message: row.error_message,
        skip_reason: row.skip_reason,
        attempts: row.attempts,
        sent_at: row.sent_at,
        created_at: row.created_at
      })),
      total,
      page,
      page_size,
      total_pages: Math.max(1, Math.ceil(total / page_size))
    };
  }
}

export const emailMarketingService = new EmailMarketingService();
