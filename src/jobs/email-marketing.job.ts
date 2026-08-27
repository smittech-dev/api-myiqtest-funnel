import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config/env.config.js';
import {
  emailMarketingService,
  type EmailMarketingRunResult
} from '../services/email-marketing.service.js';
import { logger } from '../utils/logger.util.js';

let task: ScheduledTask | null = null;
let running = false;

/** What set a run going. `manual` is an admin pressing "Run now". */
export type EmailMarketingTrigger = 'schedule' | 'manual';

/**
 * The outcome of one run, as data rather than as an exception — the same shape
 * and for the same reason as the currency job: the cron must never throw, and
 * the admin endpoint needs something it can turn into a status code.
 */
export type EmailMarketingOutcome =
  | { status: 'completed'; result: EmailMarketingRunResult }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string; statusCode: number };

/**
 * Run one pass of the sequence.
 *
 * The `running` guard is module-level and shared with the manual trigger. Two
 * overlapping passes would select the same candidates and race each other to
 * claim their steps — the unique index would stop the duplicate email, but the
 * second pass would spend a batch of database work discovering that, so the
 * second caller is told to wait instead.
 */
export async function runEmailMarketing(
  trigger: EmailMarketingTrigger
): Promise<EmailMarketingOutcome> {
  if (running) {
    const reason = 'An email marketing run is already in progress.';
    logger.warn(`Email marketing run (${trigger}) skipped — ${reason}`);
    return { status: 'skipped', reason };
  }

  running = true;

  try {
    const result = await emailMarketingService.runOnce();
    return { status: 'completed', result };
  } catch (err: any) {
    logger.error(`Email marketing run (${trigger}) failed: ${err.message}`);
    return {
      status: 'failed',
      reason: err?.message ?? 'Email marketing run failed',
      statusCode: typeof err?.statusCode === 'number' ? err.statusCode : 500
    };
  } finally {
    running = false;
  }
}

/**
 * Schedule the sequence. Controlled by EMAIL_MARKETING_ENABLED.
 *
 * Note the two switches: this one decides whether the cron exists at all, and
 * `email_marketing_settings.enabled` decides whether a registered run actually
 * sends. Keeping them separate is what lets an admin pause the sequence from
 * the panel without a deploy, while ops keeps a hard off switch that does not
 * depend on the database being reachable.
 */
export function startEmailMarketingCron(): void {
  if (!config.emailMarketing.cronEnabled) {
    logger.info('Email marketing cron is disabled (EMAIL_MARKETING_ENABLED=false).');
    return;
  }

  const expression = config.emailMarketing.cron;
  if (!cron.validate(expression)) {
    logger.error(`Invalid EMAIL_MARKETING_CRON expression "${expression}" — cron not scheduled.`);
    return;
  }

  task = cron.schedule(expression, () => void runEmailMarketing('schedule'), {
    name: 'email-marketing',
    timezone: config.emailMarketing.timezone,
    noOverlap: true
  });

  const nextRun = task.getNextRun();
  logger.info(
    `Email marketing scheduled: "${expression}" (${config.emailMarketing.timezone})` +
      (nextRun ? ` — next run ${nextRun.toISOString()}` : '')
  );
}

/** Stop the scheduled sequence (used on graceful shutdown). */
export async function stopEmailMarketingCron(): Promise<void> {
  if (!task) {
    return;
  }

  await task.stop();
  task = null;
  logger.info('Email marketing cron stopped.');
}
