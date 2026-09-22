import { AppDataSource } from '../config/database.config.js';
import { CurrencyRate } from '../entities/CurrencyRate.entity.js';
import { config } from '../config/env.config.js';
import {
  externalApiLogService,
  redactUrl,
  EXTERNAL_API_SERVICE
} from './external-api-log.service.js';
import { AppError } from '../utils/app-error.util.js';
import { logger } from '../utils/logger.util.js';

/**
 * Shape returned by exchangeratesapi.io /latest
 */
interface ExchangeRatesResponse {
  success: boolean;
  timestamp?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
  error?: { code?: number | string; type?: string; info?: string };
}

export interface CurrencySyncResult {
  synced: string[];
  /** Returned by the provider but not storable — see `syncRates` for why. */
  skipped: string[];
  source_base: string;
  fetched_at: string;
}

export class CurrencyRateService {
  private currencyRateRepository = AppDataSource.getRepository(CurrencyRate);

  /**
   * Fetch the latest rates and persist them with GBP as the base currency.
   *
   * **Every currency the provider returns is stored**, not a configured
   * shortlist. The table is a reference set — whatever the funnel needs to
   * convert today and whatever it might need tomorrow, without a redeploy to
   * add a symbol. That is why the request sends no `symbols` filter and the
   * loop below walks the response rather than a list of our own.
   *
   * `rate_to_gbp` stores how many units of the currency equal 1 GBP
   * (JPY 216.8 => 1 GBP = 216.8 JPY), so GBP itself is always stored as 1.
   *
   * A currency is skipped rather than stored when it cannot be represented
   * faithfully — see `toStorableRate`. Skipping leaves any previously stored
   * value alone, which beats overwriting a good rate with a broken one.
   */
  async syncRates(): Promise<CurrencySyncResult> {
    if (!config.currency.apiKey) {
      throw new AppError('EXCHANGERATES_API_KEY is not configured', 500);
    }

    const payload = await this.fetchLatestRates();

    const rates = payload.rates || {};
    const sourceBase = (payload.base || 'UNKNOWN').toUpperCase();

    // The free exchangeratesapi.io plan only serves EUR as the base, so the
    // response quotes every currency per 1 EUR. GBP is one of those quotes, so
    // dividing the rest of the set by it rebases everything on GBP locally —
    // EUR in, GBP stored.
    const gbpPerBase = rates.GBP;
    if (!gbpPerBase || gbpPerBase <= 0) {
      throw new AppError(
        `Exchange rate response did not include a usable GBP rate (base ${sourceBase})`,
        502
      );
    }

    const synced: string[] = [];
    const skipped: string[] = [];

    // GBP is the base by definition, whatever the provider says about it.
    const rows: { currency_code: string; rate_to_gbp: string; updated_at: Date }[] = [
      { currency_code: 'GBP', rate_to_gbp: '1.000000', updated_at: new Date() }
    ];
    synced.push('GBP');

    for (const [rawCode, rateInBase] of Object.entries(rates)) {
      const code = rawCode.toUpperCase();
      if (code === 'GBP') {
        continue;
      }

      // The column holds three characters, so anything else would fail the
      // insert and take the whole batch down with it.
      if (!/^[A-Z]{3}$/.test(code)) {
        skipped.push(code);
        continue;
      }

      const value = this.toStorableRate(rateInBase, gbpPerBase);
      if (value === null) {
        skipped.push(code);
        continue;
      }

      rows.push({ currency_code: code, rate_to_gbp: value, updated_at: new Date() });
      synced.push(code);
    }

    // One statement rather than a read-then-write per currency: the provider
    // returns upwards of 150 of them, and 300 sequential round trips would turn
    // a sub-second job into a multi-second one.
    await this.currencyRateRepository.upsert(rows, ['currency_code']);

    const fetchedAt = payload.timestamp
      ? new Date(payload.timestamp * 1000).toISOString()
      : new Date().toISOString();

    logger.info(
      `Currency sync complete — stored ${synced.length} rates (base ${sourceBase} to GBP)` +
        (skipped.length ? ` | skipped ${skipped.length}: ${skipped.join(', ')}` : '')
    );

    return { synced, skipped, source_base: sourceBase, fetched_at: fetchedAt };
  }

  /**
   * A provider rate as a value the `numeric(15,6)` column can hold, or `null`
   * when it cannot.
   *
   * Two ways that happens, and both matter more than they look:
   *
   *   - **Rounds to zero.** Six decimal places cannot express a rate below
   *     0.0000005, and gold and crypto quote well under that against a pound.
   *     Storing the rounded `0.000000` would hand a divide-by-zero to whoever
   *     converts with it later, so it is refused instead.
   *   - **Too large.** Nine integer digits is the column's ceiling. No real
   *     currency comes close, but a garbled response should cost one row rather
   *     than fail the insert and lose the whole batch.
   */
  private toStorableRate(rateInBase: number, gbpPerBase: number): string | null {
    if (!Number.isFinite(rateInBase) || rateInBase <= 0) {
      return null;
    }

    const rateToGbp = rateInBase / gbpPerBase;
    if (!Number.isFinite(rateToGbp) || rateToGbp <= 0) {
      return null;
    }

    if (rateToGbp < 0.0000005 || rateToGbp >= 1000000000) {
      return null;
    }

    return rateToGbp.toFixed(6);
  }

  /**
   * A transaction amount expressed in GBP, using the rates already stored.
   *
   * Deliberately reads the table and never the provider. A charge is recorded
   * on the request path, and a payment must not fail — or wait — because an
   * exchange rate API is slow or down. The twelve-hourly sync is what keeps
   * these rates current; this only spends them.
   *
   * `rate_to_gbp` is units of the currency per 1 GBP, so the conversion is a
   * division: JPY 2,980 at 216.69 per GBP is GBP 13.75234 — kept to five
   * decimals, because the rounding error at two would survive into every
   * aggregate built on this column.
   *
   * Returns `null` when the amount cannot be converted honestly — an unknown
   * currency, or a rate table that has never been synced. The column is
   * nullable precisely so that stays visible: a missing figure can be
   * backfilled once rates exist, whereas a wrongly-stored one is silent.
   */
  async convertToGbp(amount: number | string, currencyCode: string): Promise<string | null> {
    const value = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (!Number.isFinite(value)) {
      return null;
    }

    const code = currencyCode.toUpperCase();
    if (code === 'GBP') {
      // Already GBP — recorded as-is rather than round-tripped through a rate
      // of 1, so the stored figure is exactly the amount charged. Padded to the
      // column's five decimals; the trailing zeros are what an unconverted
      // amount honestly looks like next to a converted one.
      return value.toFixed(5);
    }

    const rate = await this.getRateToGbp(code);
    if (rate === null) {
      logger.warn(
        `Currency conversion: no stored rate for ${code} — amount_gbp left null. ` +
          'Run the currency sync to populate it.'
      );
      return null;
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      logger.warn(`Currency conversion: stored rate for ${code} is unusable (${rate}).`);
      return null;
    }

    const gbp = value / rate;
    if (!Number.isFinite(gbp) || gbp >= 10000000000) {
      // numeric(15,5) tops out at 9,999,999,999.99999.
      logger.warn(`Currency conversion: ${value} ${code} does not fit amount_gbp.`);
      return null;
    }

    // Five decimals, matching the column. A division by an exchange rate rarely
    // lands on a penny, and rounding it there loses precision that compounds
    // once a month of these is summed for reporting.
    return gbp.toFixed(5);
  }

  /**
   * Latest stored rate for a currency (units per 1 GBP). GBP always resolves to 1.
   */
  async getRateToGbp(currencyCode: string): Promise<number | null> {
    const code = currencyCode.toUpperCase();
    if (code === 'GBP') {
      return 1;
    }

    const record = await this.currencyRateRepository.findOne({
      where: { currency_code: code }
    });

    return record ? parseFloat(record.rate_to_gbp) : null;
  }

  private async fetchLatestRates(): Promise<ExchangeRatesResponse> {
    const url = new URL(`${config.currency.apiUrl.replace(/\/$/, '')}/latest`);
    url.searchParams.set('access_key', config.currency.apiKey);
    // EUR, not GBP: the free plan only issues EUR-based quotes and silently
    // ignores — or rejects — any other base. Asking for what we are actually
    // given keeps `source_base` honest; `syncRates` does the rebase to GBP.
    url.searchParams.set('base', config.currency.providerBase);
    // No `symbols` filter on purpose: omitting it is what makes the provider
    // answer with its full set, which is the point of the table. It also has to
    // include GBP, which is the pivot the rebase depends on.

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.currency.requestTimeoutMs);

    // `access_key` is a query parameter, so the stored endpoint must be the
    // masked form — never `url` itself.
    const endpoint = redactUrl(url);
    const requestPayload = { base: config.currency.providerBase };
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'request timed out' : err?.message;

      await externalApiLogService.log({
        service_name: EXTERNAL_API_SERVICE.EXCHANGE_RATES,
        endpoint,
        method: 'GET',
        request_payload: requestPayload,
        is_error: true,
        error_message: `Provider unreachable: ${reason}`,
        duration_ms: Date.now() - startedAt
      });

      throw new AppError(`Exchange rate provider unreachable: ${reason}`, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      await externalApiLogService.log({
        service_name: EXTERNAL_API_SERVICE.EXCHANGE_RATES,
        endpoint,
        method: 'GET',
        status_code: response.status,
        request_payload: requestPayload,
        is_error: true,
        error_message: `Provider returned HTTP ${response.status} ${response.statusText}`,
        duration_ms: Date.now() - startedAt
      });

      throw new AppError(
        `Exchange rate provider returned HTTP ${response.status} ${response.statusText}`,
        502
      );
    }

    const payload = (await response.json()) as ExchangeRatesResponse;

    // The API answers 200 OK with `success: false` for quota/auth/plan errors
    const providerError =
      payload.success === false || !payload.rates
        ? payload.error?.info || payload.error?.type || 'unknown provider error'
        : null;

    await externalApiLogService.log({
      service_name: EXTERNAL_API_SERVICE.EXCHANGE_RATES,
      endpoint,
      method: 'GET',
      status_code: response.status,
      request_payload: requestPayload,
      // The rate table is ~170 currencies of noise on a good day; the counts and
      // the base are what tells a sync apart, and a failure keeps its whole body.
      response_payload: providerError
        ? payload
        : {
            success: payload.success,
            base: (payload as any).base ?? null,
            timestamp: (payload as any).timestamp ?? null,
            rate_count: Object.keys(payload.rates ?? {}).length
          },
      is_error: Boolean(providerError),
      error_message: providerError ?? undefined,
      duration_ms: Date.now() - startedAt
    });

    if (providerError) {
      throw new AppError(`Exchange rate provider error: ${providerError}`, 502);
    }

    return payload;
  }
}

export const currencyRateService = new CurrencyRateService();
