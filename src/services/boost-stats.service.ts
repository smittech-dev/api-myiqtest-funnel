import { AppDataSource } from '../config/database.config.js';
import { BoostAttempt } from '../entities/BoostAttempt.entity.js';
import { BoostProfile } from '../entities/BoostProfile.entity.js';
import { MemberPointsLedger } from '../entities/MemberPointsLedger.entity.js';
import { dateKeyIn, nextMidnightIn, shiftDateKey } from '../utils/boost-date.util.js';
import { CATEGORIES, LEVELS, MAX_LEVEL, QUESTIONS_PER_LEVEL } from '../utils/boost-engine.util.js';
import { boostProgression } from './boost-quiz.service.js';
import {
  leaderboardRows,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type LeaderboardScope
} from './boost-demo.service.js';
import { progressFor, reportRows, totalPlays } from './boost-games.service.js';
import type { MemberStats } from '../types/boost.types.js';

/**
 * The figures the dashboard and the report are built from.
 *
 * The quiz figures are derived from `boost_attempts` at read time; nothing here
 * is a stored statistic except the three counters cached on the profile, and
 * those are only a cache of what these queries would return.
 *
 * The leaderboard and brain-game progress are the exception: they are the
 * prototype's demo data, served from `boost-demo.service.ts` by decision rather
 * than by omission. Where a real figure exists it is used — the member's own
 * points, streak and rank are their own.
 */

const attemptRepo = () => AppDataSource.getRepository(BoostAttempt);
const ledgerRepo = () => AppDataSource.getRepository(MemberPointsLedger);

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day of the week for a date key, without dragging a timezone back into it. */
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Every scored run the member has finished. Personality is excluded: it has no mark. */
async function scoredAttempts(customerId: string): Promise<BoostAttempt[]> {
  return attemptRepo().find({
    where: { customer_id: customerId, status: 'submitted', is_practice: false, unscored: false },
    order: { submitted_at: 'ASC' }
  });
}

/**
 * The member's estimated IQ.
 *
 * Anchored to the certificate they bought — `baseline_iq` — and moved by how
 * they actually train: sustained accuracy above chance, damped by how much
 * evidence there is, plus a small credit for levels completed.
 *
 * `volume` is the honest part. One good quiz should not move a published IQ
 * figure; sixty days of them should. Until there is evidence, the number stays
 * where the certificate put it.
 */
export function estimateIq(baselineIq: number, attempts: BoostAttempt[], levelsDone: number): number {
  if (!attempts.length) return baselineIq + Math.round(levelsDone / 3);

  const accuracy =
    attempts.reduce((sum, a) => sum + (a.correct ?? 0) / (a.total || QUESTIONS_PER_LEVEL), 0) /
    attempts.length;

  const volume = Math.min(attempts.length / 60, 1);

  return Math.round(baselineIq + (accuracy - 0.6) * 12 * volume + levelsDone / 3);
}

/**
 * Twelve months of estimated IQ, for the chart.
 *
 * Built from what the member actually did in each month, not from a smooth
 * curve: months with no training inherit the previous month's figure rather
 * than inventing movement. A product that sells an IQ number should not draw a
 * line it cannot account for.
 */
function iqHistory(
  baselineIq: number,
  attempts: BoostAttempt[],
  levelsDone: number,
  currentIq: number
): { label: string; year: number; value: number }[] {
  const now = new Date();
  const out: { label: string; year: number; value: number }[] = [];
  let carried = baselineIq;

  for (let back = 11; back >= 0; back -= 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

    const upToEnd = attempts.filter((a) => a.submitted_at && a.submitted_at < end);

    if (upToEnd.length) {
      // Levels completed is a lifetime figure; scale it to what was true then.
      const share = upToEnd.length / Math.max(attempts.length, 1);
      carried = estimateIq(baselineIq, upToEnd, Math.round(levelsDone * share));
    }

    out.push({ label: MONTHS[month.getUTCMonth()], year: month.getUTCFullYear(), value: carried });
  }

  // The last point is today's figure by definition, not a month-end estimate.
  out[out.length - 1].value = currentIq;
  return out;
}

export interface MemberSnapshot {
  stats: MemberStats;
  levelsDone: number;
  attempts: BoostAttempt[];
}

/** The numbers `GET /me` reports, and the raw rows the dashboard reuses. */
export async function memberSnapshot(profile: BoostProfile): Promise<MemberSnapshot> {
  const [attempts, progress] = await Promise.all([
    scoredAttempts(profile.customer_id),
    boostProgression.loadProgress(profile.customer_id)
  ]);

  const levelsDone = CATEGORIES.reduce(
    (total, c) => total + boostProgression.completedLevels(progress, c.key).length,
    0
  );

  return {
    attempts,
    levelsDone,
    stats: {
      streak: profile.streak,
      longestStreak: profile.longest_streak,
      points: profile.total_points,
      estimatedIq: estimateIq(profile.baseline_iq, attempts, levelsDone)
    }
  };
}

/* ── leaderboard ──────────────────────────────────────────────────────────── */

/**
 * The standings.
 *
 * Deliberately the prototype's demo field rather than a query over real members
 * — see `boost-demo.service.ts` for why. The member's own row carries their
 * real points and streak, so their position moves when they train.
 */
export async function leaderboard(
  customerId: string,
  profile: Pick<BoostProfile, 'display_name' | 'streak'>,
  period: LeaderboardPeriod = 'week',
  scope: LeaderboardScope = 'total'
): Promise<{ rows: LeaderboardRow[]; sortKey: string }> {
  const split = await pointsBySource(customerId);

  return leaderboardRows(period, scope, {
    id: customerId,
    displayName: profile.display_name ?? 'Member',
    quizPoints: split.boost,
    gamePoints: split.game,
    streak: profile.streak
  });
}

/**
 * The member's points, quiz and games kept apart.
 *
 * This is what the ledger is for: `boost_profiles.total_points` is a single
 * running total and cannot answer "how much of that was games", which is
 * exactly what the leaderboard's two columns ask.
 */
export async function pointsBySource(customerId: string): Promise<{ boost: number; game: number }> {
  const rows = await ledgerRepo()
    .createQueryBuilder('l')
    .select('l.source', 'source')
    .addSelect('COALESCE(SUM(l.points), 0)', 'points')
    .where('l.customer_id = :customerId', { customerId })
    .groupBy('l.source')
    .getRawMany<{ source: string; points: string }>();

  const split = { boost: 0, game: 0 };
  for (const row of rows) {
    if (row.source === 'boost') split.boost = Number(row.points);
    if (row.source === 'game') split.game = Number(row.points);
  }
  return split;
}

export type { LeaderboardRow };

/* ── dashboard ────────────────────────────────────────────────────────────── */

/** Everything the home screen needs, in one round trip. */
export async function dashboard(profile: BoostProfile) {
  const timezone = profile.timezone;
  const today = dateKeyIn(timezone);

  const [snapshot, progress, todaysAttempt, allSubmitted, board] = await Promise.all([
    memberSnapshot(profile),
    boostProgression.loadProgress(profile.customer_id),
    boostProgression.findTodaysAttempt(profile.customer_id, today),
    attemptRepo().find({
      where: { customer_id: profile.customer_id, status: 'submitted', is_practice: false }
    }),
    leaderboard(profile.customer_id, profile, 'week', 'total')
  ]);

  const games = await progressFor(profile.customer_id);

  const doneDays = new Set(allSubmitted.map((a) => a.date_key));

  const week = [];
  for (let back = 6; back >= 0; back -= 1) {
    const key = shiftDateKey(today, -back);
    week.push({
      key,
      label: DAY_INITIALS[weekdayOf(key)],
      done: doneDays.has(key),
      today: key === today
    });
  }

  const iq = snapshot.stats.estimatedIq;
  const history = iqHistory(profile.baseline_iq, snapshot.attempts, snapshot.levelsDone, iq);
  const previous = history[history.length - 2]?.value ?? iq;

  const solved = allSubmitted.reduce((sum, a) => sum + (a.total ?? 0), 0);
  const accuracy = snapshot.attempts.length
    ? Math.round(
        (snapshot.attempts.reduce(
          (sum, a) => sum + (a.correct ?? 0) / (a.total || QUESTIONS_PER_LEVEL),
          0
        ) /
          snapshot.attempts.length) *
          100
      )
    : 0;

  return {
    today: boostProgression.todayStateFrom(today, todaysAttempt),
    resetsAt: nextMidnightIn(timezone).getTime(),
    week,
    iq: { value: iq, delta: iq - previous, history },
    totals: {
      daysThisWeek: week.filter((d) => d.done).length,
      solved,
      plays: Object.values(games).reduce((n, g) => n + (g.plays || 0), 0),
      accuracy,
      levelsDone: snapshot.levelsDone,
      levelsTotal: CATEGORIES.length * MAX_LEVEL
    },
    categories: CATEGORIES.map((c) => boostProgression.categorySummary(progress, c)),
    leaderboard: {
      top: board.rows.slice(0, 3),
      me: board.rows.find((r) => r.me) ?? null,
      totalPlayers: board.rows.length
    },
    games: Object.entries(games).map(([slug, rec]) => ({ slug, ...rec }))
  };
}

/* ── report ───────────────────────────────────────────────────────────────── */

export type ReportPeriod = 'week' | 'month' | 'all';

/**
 * The progress report.
 *
 * The quiz half is real — domains, levels, streak, accuracy and the estimated
 * IQ all come from `boost_attempts`, and are the same figures the dashboard
 * shows. Two screens quoting different numbers for the same thing is worse than
 * either number being wrong.
 *
 * The games half is the prototype's demo data, matching the games screen.
 */
export async function report(profile: BoostProfile, period: ReportPeriod = 'month') {
  const cutoff =
    period === 'week'
      ? new Date(Date.now() - 7 * 864e5)
      : period === 'month'
        ? new Date(Date.now() - 31 * 864e5)
        : new Date(0);

  const [snapshot, progress, personality] = await Promise.all([
    memberSnapshot(profile),
    boostProgression.loadProgress(profile.customer_id),
    boostProgression.latestPersonalityProfile(profile.customer_id)
  ]);

  const inPeriod = snapshot.attempts.filter((a) => a.submitted_at && a.submitted_at >= cutoff);

  const accuracy = inPeriod.length
    ? Math.round(
        (inPeriod.reduce((sum, a) => sum + (a.correct ?? 0) / (a.total || QUESTIONS_PER_LEVEL), 0) /
          inPeriod.length) *
          100
      )
    : 0;

  const summaries = CATEGORIES.map((c) => boostProgression.categorySummary(progress, c));

  /**
   * A domain is scored out of 100: twenty per completed level, plus a partial
   * credit for the level in play, discounted because a good score on a level
   * that has not been passed is not the same as passing it.
   */
  const domains = summaries
    .filter((c) => !c.unscored)
    .map((c) => {
      const inPlay = c.levels.find((l) => l.status === 'available');
      const partial = inPlay?.best ? (inPlay.best / QUESTIONS_PER_LEVEL) * 20 * 0.75 : 0;
      return {
        key: c.key,
        label: c.label,
        completedLevels: c.completedLevels,
        currentLevel: c.currentLevel,
        score: Math.min(100, Math.round(c.completedLevels * 20 + partial))
      };
    })
    .sort((a, b) => b.score - a.score);

  // Games in the report are the member's own runs, counted over the same window
  // as the quiz figures beside them — a "this month" report that quotes lifetime
  // game plays would be quietly comparing two different periods.
  const [games, gamePlays] = await Promise.all([
    reportRows(profile.customer_id),
    totalPlays(profile.customer_id, period === 'all' ? undefined : cutoff)
  ]);

  const iq = snapshot.stats.estimatedIq;

  return {
    period,
    iq: { value: iq, history: iqHistory(profile.baseline_iq, snapshot.attempts, snapshot.levelsDone, iq) },
    domains,
    personality,
    totals: {
      // Roughly seven minutes a quiz and two a game — the prototype's own
      // estimate, and honest enough for a "time invested" line.
      minutes: inPeriod.length * 7 + gamePlays * 2,
      streak: profile.streak,
      longestStreak: profile.longest_streak,
      accuracy,
      sessions: inPeriod.length
    },
    categories: summaries.map((c) => ({
      key: c.key,
      label: c.label,
      unscored: c.unscored,
      attempts: c.levels.reduce((n, l) => n + l.attempts, 0),
      completedLevels: c.completedLevels,
      currentLevel: c.currentLevel,
      best: c.levels.find((l) => l.level === c.currentLevel)?.best ?? null
    })),
    games
  };
}

export { LEVELS };
