import cron, { ScheduledTask } from 'node-cron';
import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { customerEmailService } from '../services/customer-email.service.js';
import { logger } from '../utils/logger.util.js';

/**
 * Applies the wallet's email address to customers who paid with Apple Pay or
 * Google Pay and did not give one on the Personal Detail page in time.
 *
 * ## Why a table and a tick, not a timer
 *
 * The obvious build is a `setTimeout` for ten minutes after each payment. It
 * would lose every pending replacement on a restart or a deploy, and run each
 * one twice whenever two processes are up — which, as the duplicate pm2
 * process showed, does happen. So the work lives in the database
 * (`pending_email` / `pending_email_due_at` on the quiz row) and this tick
 * picks up whatever has come due. A restart delays a replacement by at most a
 * minute; it never drops one.
 *
 * ## Why it is safe with more than one process
 *
 * Each due row is claimed by clearing its due time in the same statement that
 * selects it, under `FOR UPDATE SKIP LOCKED`: two processes ticking at once
 * take disjoint rows and never the same one. The assignment itself then takes
 * a row lock, and does nothing if a real address arrived first.
 */

let task: ScheduledTask | null = null;
let running = false;

/** Rows taken per tick. Generous: a tick that finds more simply runs again next minute. */
const BATCH = 50;

/** How long to wait before retrying a replacement that failed. */
const RETRY_MINUTES = 5;

interface DueRow {
  id: string;
  pending_email: string;
}

export async function runWalletEmailReplacement(): Promise<{ applied: number; failed: number }> {
  if (running) return { applied: 0, failed: 0 };
  running = true;

  let applied = 0;
  let failed = 0;

  try {
    if (!AppDataSource.isInitialized) return { applied, failed };

    const raw = await AppDataSource.query(
      `
      UPDATE customer_quiz_results
         SET pending_email_due_at = NULL
       WHERE id IN (
               SELECT id
                 FROM customer_quiz_results
                WHERE pending_email_due_at <= NOW()
                  AND pending_email IS NOT NULL
                ORDER BY pending_email_due_at
                LIMIT $1
                  FOR UPDATE SKIP LOCKED
             )
      RETURNING id, pending_email
      `,
      [BATCH]
    );

    // node-postgres hands an UPDATE ... RETURNING back as [rows, count].
    const rows: DueRow[] = Array.isArray(raw?.[0]) ? raw[0] : raw;

    for (const row of rows) {
      try {
        const outcome = await customerEmailService.assign(
          String(row.id),
          row.pending_email,
          'wallet_fallback'
        );
        if (outcome.applied) applied += 1;
      } catch (err: any) {
        failed += 1;
        // Put it back on the clock rather than dropping it: a customer whose
        // replacement failed is a customer without their welcome email.
        logger.error(
          `Wallet email replacement failed for quiz ${row.id}: ${err?.message ?? err} — ` +
            `retrying in ${RETRY_MINUTES} minutes.`
        );
        await AppDataSource.query(
          `UPDATE customer_quiz_results
              SET pending_email_due_at = NOW() + ($2::int * INTERVAL '1 minute')
            WHERE id = $1 AND pending_email IS NOT NULL AND pending_email_due_at IS NULL`,
          [row.id, RETRY_MINUTES]
        );
      }
    }

    if (rows.length) {
      logger.info(
        `Wallet email replacement: ${rows.length} due, ${applied} applied, ${failed} failed ` +
          `(${rows.length - applied - failed} already had a real address).`
      );
    }
  } catch (err: any) {
    logger.error(`Wallet email replacement run failed: ${err?.message ?? err}`);
  } finally {
    running = false;
  }

  return { applied, failed };
}

/** Always on: it is how a wallet payer's welcome email reaches them. */
export function startWalletEmailCron(): void {
  const expression = config.walletEmail.cron;
  if (!cron.validate(expression)) {
    logger.error(`Invalid WALLET_EMAIL_CRON expression "${expression}" — cron not scheduled.`);
    return;
  }

  task = cron.schedule(expression, () => void runWalletEmailReplacement(), {
    name: 'wallet-email-replacement',
    noOverlap: true
  });

  logger.info(
    `Wallet email replacement scheduled: "${expression}", ` +
      `${config.walletEmail.delayMinutes} minutes after payment.`
  );
}

export async function stopWalletEmailCron(): Promise<void> {
  if (!task) return;
  await task.stop();
  task = null;
  logger.info('Wallet email replacement cron stopped.');
}
