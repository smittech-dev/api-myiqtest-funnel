import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database.config.js';
import { CurrencyRate } from '../entities/CurrencyRate.entity.js';
import { runCurrencyRateSync } from '../jobs/currency-rate.job.js';
import { ResponseUtil } from '../utils/api-response.util.js';

export class AdminCurrencyController {
  /**
   * POST /admin/currency-rates/sync
   *
   * Runs exactly what the twelve-hourly cron runs — the same function, sharing
   * the same overlap guard — so an operator can refresh rates on demand rather
   * than waiting for the next tick.
   *
   * It deliberately does **not** check `CURRENCY_SYNC_ENABLED`: that switch
   * governs the schedule, and turning the schedule off is not a reason to
   * refuse a refresh someone explicitly asked for. `EXCHANGERATES_API_KEY` is
   * still required, and its absence surfaces as the service's own error.
   */
  static async sync(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const outcome = await runCurrencyRateSync('manual');

      if (outcome.status === 'skipped') {
        // Another sync — scheduled or manual — holds the guard. Not an error
        // the operator caused, and retrying in a moment will work.
        ResponseUtil.error(res, outcome.reason, 409);
        return;
      }

      if (outcome.status === 'failed') {
        ResponseUtil.error(res, outcome.reason, outcome.statusCode);
        return;
      }

      // The rates as they now stand, so the caller can show the result without
      // a second request.
      const rates = await AppDataSource.getRepository(CurrencyRate).find({
        order: { currency_code: 'ASC' }
      });

      ResponseUtil.success(
        res,
        {
          synced: outcome.result.synced,
          skipped: outcome.result.skipped,
          source_base: outcome.result.source_base,
          fetched_at: outcome.result.fetched_at,
          duration_ms: outcome.duration_ms,
          rates: rates.map((rate) => ({
            currency_code: rate.currency_code,
            // Stored as a numeric column, which the driver hands back as a
            // string — sent as a number so the caller does not have to parse it.
            rate_to_gbp: parseFloat(rate.rate_to_gbp),
            updated_at: rate.updated_at
          }))
        },
        'Currency rates updated successfully'
      );
    } catch (error) {
      next(error);
    }
  }
}
