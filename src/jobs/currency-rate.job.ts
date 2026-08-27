import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config/env.config.js';
import { currencyRateService, type CurrencySyncResult } from '../services/currency-rate.service.js';
import { logger } from '../utils/logger.util.js';

let task: ScheduledTask | null = null;
let running = false;

/** What set a refresh going. `manual` is an admin pressing the button. */
export type SyncTrigger = 'startup' | 'schedule' | 'manual';

/**
 * The outcome of one refresh, as data rather than as an exception.
 *
 * The scheduled path must never throw — a provider outage cannot be allowed to
 * take the process down — while the admin path needs to tell the operator what
 * happened. Returning a discriminated result serves both: the cron ignores it,
 * the controller turns it into a status code.
 */
export type SyncOutcome =
  | { status: 'completed'; result: CurrencySyncResult; duration_ms: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string; statusCode: number };

/**
 * Run one refresh, whoever asked for it.
 *
 * The `running` flag is deliberately module-level and shared with the manual
 * trigger rather than being per-caller. Two overlapping syncs would spend two
 * calls of a metered provider quota to write the same rows, and would race each
 * other doing it — so the second caller is told to wait instead.
 */
export async function runCurrencyRateSync(trigger: SyncTrigger): Promise<SyncOutcome> {
  if (running) {
    const reason = 'A currency rate sync is already in progress.';
    logger.warn(`Currency rate sync (${trigger}) skipped — ${reason}`);
    return { status: 'skipped', reason };
  }

  running = true;
  const startedAt = Date.now();

  try {
    const result = await currencyRateService.syncRates();
    const duration = Date.now() - startedAt;
    logger.info(
      `Currency rate sync (${trigger}) succeeded in ${duration}ms — ` +
        `base ${result.source_base} → GBP, updated: ${result.synced.join(', ')}`
    );
    return { status: 'completed', result, duration_ms: duration };
  } catch (err: any) {
    logger.error(`Currency rate sync (${trigger}) failed: ${err.message}`);
    // `AppError` carries the provider's own status (502 unreachable, 500 for a
    // missing key); anything else is genuinely unexpected.
    return {
      status: 'failed',
      reason: err?.message ?? 'Currency rate sync failed',
      statusCode: typeof err?.statusCode === 'number' ? err.statusCode : 500
    };
  } finally {
    running = false;
  }
}

/**
 * Schedule the exchange-rate refresh. Controlled by CURRENCY_SYNC_ENABLED.
 */
export function startCurrencyRateCron(): void {
  if (!config.currency.syncEnabled) {
    logger.info('Currency rate sync is disabled (CURRENCY_SYNC_ENABLED=false).');
    return;
  }

  if (!config.currency.apiKey) {
    logger.warn(
      'Currency rate sync is enabled but EXCHANGERATES_API_KEY is empty — cron not scheduled.'
    );
    return;
  }

  const expression = config.currency.syncCron;
  if (!cron.validate(expression)) {
    logger.error(`Invalid CURRENCY_SYNC_CRON expression "${expression}" — cron not scheduled.`);
    return;
  }

  task = cron.schedule(expression, () => void runCurrencyRateSync('schedule'), {
    name: 'currency-rate-sync',
    timezone: config.currency.syncTimezone,
    noOverlap: true
  });

  const nextRun = task.getNextRun();
  logger.info(
    `Currency rate sync scheduled: "${expression}" (${config.currency.syncTimezone})` +
      (nextRun ? ` — next run ${nextRun.toISOString()}` : '')
  );

  if (config.currency.syncOnStartup) {
    void runCurrencyRateSync('startup');
  }
}

/**
 * Stop the scheduled refresh (used on graceful shutdown).
 */
export async function stopCurrencyRateCron(): Promise<void> {
  if (!task) {
    return;
  }

  await task.stop();
  task = null;
  logger.info('Currency rate sync stopped.');
}
