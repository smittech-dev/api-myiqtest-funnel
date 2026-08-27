import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.util.js';

export interface DiscountCodeEntry {
  code: string;
  discount: number;
}

/**
 * Discount codes live in `data/discount-codes.json`, not in the environment, so
 * marketing can rotate them without touching deployment config:
 *
 * {
 *   "K75QSQC": { "code": "K75QSQC", "discount": 20 }
 * }
 *
 * The file is read once at startup — **editing it requires a restart.**
 */
const DISCOUNT_CODES_FILE = path.resolve(process.cwd(), 'data', 'discount-codes.json');

function loadDiscountCodes(): Record<string, DiscountCodeEntry> {
  let raw: string;

  try {
    raw = fs.readFileSync(DISCOUNT_CODES_FILE, 'utf-8');
  } catch {
    logger.warn(
      `No discount code file at ${DISCOUNT_CODES_FILE} — every discount code will be rejected.`
    );
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    logger.error(`discount-codes.json is not valid JSON (${err.message}) — no codes loaded.`);
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error('discount-codes.json must be an object keyed by code — no codes loaded.');
    return {};
  }

  const map: Record<string, DiscountCodeEntry> = {};

  for (const [key, value] of Object.entries(parsed as Record<string, any>)) {
    const code = String(value?.code ?? key).trim().toUpperCase();
    const discount = Number(value?.discount);

    if (!code) {
      logger.warn(`discount-codes.json: entry "${key}" has no usable code — skipped.`);
      continue;
    }

    if (!Number.isFinite(discount) || discount <= 0 || discount >= 100) {
      logger.warn(
        `discount-codes.json: code "${code}" has an invalid discount (${value?.discount}) — skipped.`
      );
      continue;
    }

    if (code !== key.trim().toUpperCase()) {
      // The `code` field wins; flag it so a typo does not silently change which
      // string customers must type.
      logger.warn(
        `discount-codes.json: key "${key}" does not match its code "${code}" — using "${code}".`
      );
    }

    map[code] = { code, discount };
  }

  logger.info(`Loaded ${Object.keys(map).length} discount code(s) from discount-codes.json`);
  return map;
}

export const discountCodes = loadDiscountCodes();
