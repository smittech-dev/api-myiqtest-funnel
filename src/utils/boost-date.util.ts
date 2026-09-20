import { logger } from './logger.util.js';

/**
 * The member's local day.
 *
 * "One attempt per day", the streak and the countdown to the next quiz are all
 * defined in the member's own calendar day, not the server's. Deriving them
 * from server time would give a member in Tokyo a day that rolls over at 9am
 * local, or hand them two quizzes on the day they fly to London.
 *
 * So everything here takes an IANA timezone, read from `boost_profiles`, and
 * nothing anywhere else in the module calls `new Date()` to decide what day it
 * is.
 *
 * Implemented on `Intl` rather than a date library: the runtime already carries
 * the timezone database, and the alternative is a dependency for two functions.
 */

export const DEFAULT_TIMEZONE = 'Asia/Tokyo';

const validated = new Map<string, boolean>();

/** Whether the runtime recognises this zone. Results memoised — it is not cheap. */
export function isValidTimezone(tz: string): boolean {
  const cached = validated.get(tz);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  validated.set(tz, ok);
  return ok;
}

/** Falls back rather than throwing: a bad zone must not make a member unable to play. */
export function safeTimezone(tz: string | null | undefined): string {
  if (tz && isValidTimezone(tz)) return tz;
  if (tz) logger.warn(`Unknown timezone "${tz}" — falling back to ${DEFAULT_TIMEZONE}.`);
  return DEFAULT_TIMEZONE;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(tz: string, at: Date): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const got: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== 'literal') got[p.type] = Number(p.value);
  }

  return {
    year: got.year,
    // Intl renders midnight as hour 24 in some runtimes; 24:00 is 00:00 the same day.
    month: got.month,
    day: got.day,
    hour: got.hour === 24 ? 0 : got.hour,
    minute: got.minute,
    second: got.second
  };
}

/**
 * How far the zone is from UTC at that instant, in milliseconds.
 * Derived by reading the wall clock and pretending it is UTC — which is exactly
 * the difference we want, and stays correct across DST changes.
 */
function offsetMs(tz: string, at: Date): number {
  const p = partsIn(tz, at);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** 'YYYY-MM-DD' as the member's calendar reads it right now. */
export function dateKeyIn(tz: string, at: Date = new Date()): string {
  const p = partsIn(safeTimezone(tz), at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The instant of the member's next local midnight — when today's quiz resets.
 *
 * Resolved twice because the offset on the far side of midnight can differ from
 * the offset now: on a DST boundary the first guess lands an hour out, and the
 * second pass corrects it. Japan never needs the second pass; members elsewhere
 * do.
 */
export function nextMidnightIn(tz: string, at: Date = new Date()): Date {
  const zone = safeTimezone(tz);
  const p = partsIn(zone, at);

  const wallMidnight = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0);
  let instant = wallMidnight - offsetMs(zone, at);
  instant = wallMidnight - offsetMs(zone, new Date(instant));

  return new Date(instant);
}

/**
 * Calendar arithmetic on a date key, with no timezone involved.
 *
 * Walking a streak backwards is a question about the member's calendar, not
 * about instants: "the day before 2026-03-01" is 2026-02-28 in every zone.
 * Doing it this way means a DST change cannot silently skip or repeat a day.
 */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Epoch milliseconds, or null — the shape every timestamp takes on the wire. */
export const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);

/**
 * A timezone guess from the funnel's two-letter country code.
 *
 * Only the markets the funnel actually sells into are listed; anything else
 * falls back. A member can correct it from the profile screen, and a wrong
 * guess costs them a day boundary in the wrong place, not their progress.
 */
const COUNTRY_TIMEZONES: Record<string, string> = {
  JP: 'Asia/Tokyo',
  GB: 'Europe/London',
  US: 'America/New_York',
  AU: 'Australia/Sydney',
  CA: 'America/Toronto',
  SG: 'Asia/Singapore',
  KR: 'Asia/Seoul',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  IN: 'Asia/Kolkata'
};

export function timezoneForCountry(code: string | null | undefined): string {
  if (!code) return DEFAULT_TIMEZONE;
  return COUNTRY_TIMEZONES[code.toUpperCase()] ?? DEFAULT_TIMEZONE;
}
