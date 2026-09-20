import { Request, Response, NextFunction } from 'express';
import { BoostResponse } from '../utils/boost-response.util.js';
import { loadMember } from '../services/boost-profile.service.js';
import {
  getOverview,
  startAttempt,
  getCurrentAttempt,
  getAttempt,
  saveProgress,
  submitAttempt
} from '../services/boost-quiz.service.js';
import { dashboard, leaderboard, report } from '../services/boost-stats.service.js';
import {
  GAMES_BY_SLUG,
  progressFor,
  progressForGame,
  submitRun
} from '../services/boost-games.service.js';
import { BoostError } from '../utils/boost-response.util.js';

/**
 * The `:id` path parameter, as a string.
 *
 * `@types/express` v5 types a param as `string | string[]` because a route can
 * repeat one. Ours cannot, so this narrows it in the single place that matters
 * rather than casting at every call site.
 */
const attemptIdOf = (req: Request): string =>
  Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

const slugOf = (req: Request): string =>
  Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;

/**
 * Boost My IQ.
 *
 * Every handler resolves the member's timezone first, because every rule this
 * module enforces — the daily limit, expiry at midnight, the streak — is stated
 * in the member's own calendar day rather than the server's.
 */
export class BoostQuizController {
  /** GET /boost — categories, level statuses and what today looks like. */
  static async overview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);
      BoostResponse.ok(res, await getOverview(profile.customer_id, profile.timezone));
    } catch (error) {
      next(error);
    }
  }

  /** GET /dashboard — the whole home screen in one round trip. */
  static async dashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);
      BoostResponse.ok(res, await dashboard(profile));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /boost/attempts — start, or resume what is already open.
   *
   * Starting spends the day even if the quiz is never submitted, so the errors
   * this can raise are part of the product, not edge cases: `level_locked`,
   * `attempt_in_progress`, `daily_limit_reached`.
   */
  static async start(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);
      const { category, level } = req.body ?? {};

      const result = await startAttempt(profile.customer_id, profile.timezone, category, level);
      BoostResponse.ok(res, result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /boost/attempts/current — today's attempt: questions, or the result. */
  static async current(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);
      BoostResponse.ok(res, await getCurrentAttempt(profile.customer_id, profile.timezone));
    } catch (error) {
      next(error);
    }
  }

  /** GET /boost/attempts/:id — any of the member's own attempts. Practice opens this way. */
  static async byId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      BoostResponse.ok(res, await getAttempt(req.member!.customerId, attemptIdOf(req)));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /boost/attempts/:id/progress — autosave.
   *
   * 204 and nothing else: the client fires this continuously and has no use for
   * a body. It is also the reason a quiz can be resumed on another device at
   * the question the member left off on.
   */
  static async progress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { index, answers, studied, timing } = req.body ?? {};
      await saveProgress(req.member!.customerId, attemptIdOf(req), { index, answers, studied, timing });
      BoostResponse.noContent(res);
    } catch (error) {
      next(error);
    }
  }

  /** POST /boost/attempts/:id/submit — mark it, award points, move the progression on. */
  static async submit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);

      const outcome = await submitAttempt(
        profile.customer_id,
        profile.timezone,
        attemptIdOf(req),
        req.body?.answers
      );

      BoostResponse.ok(res, outcome);
    } catch (error) {
      next(error);
    }
  }

  /** GET /leaderboard */
  static async leaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);

      const period = (['today', 'week', 'all'] as const).find((p) => p === req.query.period) ?? 'week';
      const scope = (['total', 'quiz', 'game'] as const).find((s) => s === req.query.scope) ?? 'total';

      const { rows, sortKey } = await leaderboard(profile.customer_id, profile, period, scope);
      const me = rows.find((r) => r.me) ?? null;

      BoostResponse.ok(res, {
        period,
        scope,
        sortKey,
        rows,
        me,
        totalPlayers: rows.length,
        percentile: me && rows.length ? Math.max(1, Math.round((me.rank / rows.length) * 100)) : null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /games — the member's progress across the twenty-five games.
   *
   * Aggregated from their own runs. Games never played are simply absent, which
   * is what the client already expects: it renders a card for every game in its
   * own catalogue and reads progress off this map when there is any.
   */
  static async games(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      BoostResponse.ok(res, { progress: await progressFor(req.member!.customerId) });
    } catch (error) {
      next(error);
    }
  }

  /** GET /games/:slug — one game, with the member's standing on it. */
  static async game(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = slugOf(req);
      const game = GAMES_BY_SLUG[slug];
      if (!game) throw new BoostError(404, 'not_found', 'Game not found.');

      const { profile } = await loadMember(req.member!.customerId);

      const [progress, board] = await Promise.all([
        progressForGame(profile.customer_id, slug),
        leaderboard(profile.customer_id, profile, 'week', 'game')
      ]);

      BoostResponse.ok(res, {
        game,
        progress,
        rank: board.rows.find((r) => r.me)?.rank ?? null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /games/:slug/score — record one finished run.
   *
   * The score is the one number in the product a member can put a value of
   * their own choosing on, so it is bounded before it is stored, and what counts
   * as a personal best is decided here rather than sent by the client: Number
   * Chase is measured in seconds, and a client allowed to decide would
   * "improve" by getting slower.
   */
  static async submitScore(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);

      const outcome = await submitRun(
        profile.customer_id,
        profile.timezone,
        slugOf(req),
        req.body?.score,
        req.body?.durationMs
      );

      BoostResponse.ok(res, outcome);
    } catch (error) {
      next(error);
    }
  }

  /** GET /reports?period=week|month|all */
  static async report(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { profile } = await loadMember(req.member!.customerId);
      const period =
        (['week', 'month', 'all'] as const).find((p) => p === req.query.period) ?? 'month';

      BoostResponse.ok(res, await report(profile, period));
    } catch (error) {
      next(error);
    }
  }
}
