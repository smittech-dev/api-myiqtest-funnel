// @ts-ignore — plain JavaScript, copied verbatim from the frontend. See src/boost-demo/README.md.
import * as catalog from '../boost-demo/catalog.js';
import { AppDataSource } from '../config/database.config.js';
import { GameRun } from '../entities/GameRun.entity.js';
import { BoostProfile } from '../entities/BoostProfile.entity.js';
import { MemberPointsLedger } from '../entities/MemberPointsLedger.entity.js';
import { BoostError } from '../utils/boost-response.util.js';
import { dateKeyIn } from '../utils/boost-date.util.js';
import { logger } from '../utils/logger.util.js';

/**
 * Brain games.
 *
 * The same division as the quiz: the games themselves are code, and only what a
 * member did is data. Nothing about the twenty-five games is stored — rules,
 * blurbs, durations and star thresholds all live in the catalogue, which the
 * client renders from its own copy. One row per finished run is the whole
 * backend.
 *
 * Personal best, plays and average are aggregates over those rows rather than
 * stored counters, so there is no rollup that can drift away from the runs it
 * summarises.
 */

export interface GameMeta {
  slug: string;
  title: string;
  cat: string;
  unit: string;
  scoreMode: 'points' | 'level' | 'time';
  lowerIsBetter: boolean;
  stars: [number, number, number];
  duration: number | null;
}

export const GAMES: GameMeta[] = catalog.GAMES;
export const GAMES_BY_SLUG: Record<string, GameMeta> = catalog.GAMES_BY_SLUG;

const runRepo = () => AppDataSource.getRepository(GameRun);
const profileRepo = () => AppDataSource.getRepository(BoostProfile);
const ledgerRepo = () => AppDataSource.getRepository(MemberPointsLedger);

const isUniqueViolation = (e: any): boolean => e?.code === '23505' || e?.driverError?.code === '23505';

/* ── scoring ──────────────────────────────────────────────────────────────── */

/**
 * Ranking points for one run, on a comparable scale whatever the score unit.
 *
 * `level` games score in levels cleared and `time` games in seconds where lower
 * wins, so a flat rule would make one category worth twenty times another.
 */
export function gamePoints(game: GameMeta, score: number): number {
  if (game.scoreMode === 'level') return Math.max(5, Math.round(score * 15));
  if (game.lowerIsBetter) {
    return score > 0 ? Math.max(5, Math.min(60, Math.round(1800 / score))) : 5;
  }
  return Math.max(5, Math.min(80, Math.round(score / 10)));
}

/**
 * How far past the three-star threshold a score can plausibly go.
 *
 * This is a sanity bound, not anti-cheat, and the distinction matters: a client
 * that runs the game can always report the score it likes, and the only real
 * defence would be simulating the game server-side — which is not worth it for
 * a training app. What this stops is the absurd case, someone posting
 * 999,999,999 and owning the leaderboard forever.
 *
 * Eight times the three-star score is comfortably above any human ceiling. The
 * engine caps its combo multiplier at x3 and awards about ten points a hit, so
 * a sixty-second game tops out somewhere near 3,600 against a three-star of 750.
 */
const PLAUSIBLE_MULTIPLE = 8;

/** The widest score this game could honestly produce, as `[min, max]`. */
export function plausibleRange(game: GameMeta): [number, number] {
  const threeStar = game.stars[2];

  if (game.lowerIsBetter) {
    // Seconds. A floor, because nobody finishes in two, and a ceiling only to
    // reject nonsense — a slow run is not suspicious, it is just slow.
    return [Math.max(3, Math.round(threeStar / 3)), 3600];
  }

  return [0, threeStar * PLAUSIBLE_MULTIPLE];
}

/* ── progress ─────────────────────────────────────────────────────────────── */

export interface GameProgress {
  best: number;
  plays: number;
  avg: number;
  lastPlayed: number;
}

interface RawRollup {
  slug: string;
  plays: string;
  avg: string;
  max: string;
  min: string;
  last_played: Date;
}

/**
 * Every game this member has played, aggregated.
 *
 * One query for all twenty-five, because the games screen needs the lot and
 * twenty-five round trips to render one page would be absurd. Games never
 * played are simply absent, which is what the client already expects.
 */
export async function progressFor(customerId: string): Promise<Record<string, GameProgress>> {
  const rows = await runRepo()
    .createQueryBuilder('r')
    .select('r.slug', 'slug')
    .addSelect('COUNT(*)', 'plays')
    .addSelect('AVG(r.score)', 'avg')
    .addSelect('MAX(r.score)', 'max')
    .addSelect('MIN(r.score)', 'min')
    .addSelect('MAX(r.played_at)', 'last_played')
    .where('r.customer_id = :customerId', { customerId })
    .groupBy('r.slug')
    .getRawMany<RawRollup>();

  const progress: Record<string, GameProgress> = {};

  for (const row of rows) {
    const game = GAMES_BY_SLUG[row.slug];
    // A slug no longer in the catalogue: the history stays in the table, but
    // there is nothing to show it against.
    if (!game) continue;

    progress[row.slug] = {
      // The whole reason "best" is computed here and not stored: for Number
      // Chase the best run is the shortest one.
      best: Number(game.lowerIsBetter ? row.min : row.max),
      plays: Number(row.plays),
      avg: Math.round(Number(row.avg) * 10) / 10,
      lastPlayed: new Date(row.last_played).getTime()
    };
  }

  return progress;
}

export async function progressForGame(
  customerId: string,
  slug: string
): Promise<GameProgress | null> {
  const all = await progressFor(customerId);
  return all[slug] ?? null;
}

/** Total runs across every game — the dashboard's "plays" figure. */
export async function totalPlays(customerId: string, since?: Date): Promise<number> {
  const query = runRepo()
    .createQueryBuilder('r')
    .where('r.customer_id = :customerId', { customerId });

  if (since) query.andWhere('r.played_at >= :since', { since });

  return query.getCount();
}

/* ── submitting a run ─────────────────────────────────────────────────────── */

export interface ScoreOutcome {
  best: number;
  avg: number;
  isBest: boolean;
  points: number;
  plays: number;
}

/**
 * Records one finished run.
 *
 * The score is the one number in the whole product a member can put a value of
 * their choosing on, so it is bounded before it is stored, and what counts as a
 * personal best is decided here rather than sent by the client — Number Chase is
 * measured in seconds, and a client allowed to decide would "improve" by getting
 * slower.
 */
export async function submitRun(
  customerId: string,
  timezone: string,
  slug: string,
  rawScore: unknown,
  rawDurationMs: unknown
): Promise<ScoreOutcome> {
  const game = GAMES_BY_SLUG[slug];
  if (!game) throw new BoostError(404, 'not_found', 'Game not found.');

  const score = Number(rawScore);
  if (!Number.isFinite(score)) {
    throw new BoostError(422, 'invalid_score', 'That score could not be read.');
  }

  // Kept to one decimal, matching the column and what the games produce: points
  // and levels are whole, Number Chase reports tenths of a second.
  const rounded = Math.round(score * 10) / 10;
  const [min, max] = plausibleRange(game);

  if (rounded < min || rounded > max) {
    // Logged rather than silently clamped: a clamp would record a score the
    // member did not get, and quietly hide whatever produced it.
    logger.warn(
      `Rejected implausible ${slug} score ${rounded} from customer ${customerId} (allowed ${min}-${max}).`
    );
    throw new BoostError(422, 'invalid_score', 'That score could not be recorded. Please play the game again.');
  }

  const duration = Number(rawDurationMs);
  const durationMs =
    Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 6 * 60 * 60 * 1000) : null;

  const previous = await progressForGame(customerId, slug);

  const isBest =
    previous == null
      ? true
      : game.lowerIsBetter
        ? rounded < previous.best
        : rounded > previous.best;

  const points = gamePoints(game, rounded);

  const run = await runRepo().save(
    runRepo().create({
      customer_id: customerId,
      slug,
      score: String(rounded),
      points,
      date_key: dateKeyIn(timezone),
      duration_ms: durationMs
    })
  );

  await awardPoints(customerId, run, points);

  const updated = await progressForGame(customerId, slug);

  return {
    best: updated?.best ?? rounded,
    avg: updated?.avg ?? rounded,
    isBest,
    points,
    plays: updated?.plays ?? 1
  };
}

/**
 * Credits the run's points.
 *
 * The ledger row is the per-day record; `boost_profiles.total_points` is the
 * running total every screen reads. The unique index on (source, ref_id) means a
 * retried request cannot pay twice for the same run.
 */
async function awardPoints(customerId: string, run: GameRun, points: number): Promise<void> {
  if (points <= 0) return;

  try {
    await ledgerRepo().save(
      ledgerRepo().create({
        customer_id: customerId,
        source: 'game',
        ref_id: run.id,
        points,
        date_key: run.date_key
      })
    );
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      logger.warn(`Points for game run ${run.id} were already awarded — ignoring the repeat.`);
      return;
    }
    throw error;
  }

  await profileRepo().increment({ customer_id: customerId }, 'total_points', points);
}

/* ── report ───────────────────────────────────────────────────────────────── */

export interface GameReportRow {
  slug: string;
  title: string;
  unit: string;
  plays: number;
  avg: number;
  best: number;
}

/**
 * The games section of the report: what the member has actually played, busiest
 * first. Titles and units come from the catalogue rather than the table, which
 * is why renaming a game does not need a migration.
 */
export async function reportRows(customerId: string): Promise<GameReportRow[]> {
  const progress = await progressFor(customerId);

  return Object.entries(progress)
    .map(([slug, rec]) => ({
      slug,
      title: GAMES_BY_SLUG[slug]?.title ?? slug,
      unit: GAMES_BY_SLUG[slug]?.unit ?? '',
      plays: rec.plays,
      avg: rec.avg,
      best: rec.best
    }))
    .sort((a, b) => b.plays - a.plays);
}
