import { AppError } from './app-error.util.js';
import { DateRangeFilter } from '../types/admin.types.js';

/**
 * Parses the `from` / `to` query pair used by every admin filter.
 *
 * A bare `YYYY-MM-DD` is widened to cover the whole day in UTC — `from` starts
 * at 00:00:00.000 and `to` ends at 23:59:59.999 — so a single-day filter
 * actually returns that day rather than an empty window. A full ISO timestamp
 * is honoured as given, for callers that need finer control.
 */
export function parseDateRange(from?: string, to?: string): DateRangeFilter {
  const range: DateRangeFilter = {};

  if (from) {
    range.from = parseBoundary(from, 'from', false);
  }
  if (to) {
    range.to = parseBoundary(to, 'to', true);
  }

  if (range.from && range.to && range.from > range.to) {
    throw new AppError('The "from" date must not be after the "to" date.', 400);
  }

  return range;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBoundary(value: string, field: string, isEnd: boolean): Date {
  if (DATE_ONLY.test(value)) {
    const suffix = isEnd ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    const parsed = new Date(`${value}${suffix}`);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(`Invalid "${field}" date: ${value}`, 400);
    }
    return parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(
      `Invalid "${field}" date: ${value}. Use YYYY-MM-DD or a full ISO timestamp.`,
      400
    );
  }
  return parsed;
}
