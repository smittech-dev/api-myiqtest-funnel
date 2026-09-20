import crypto from 'crypto';
import { AppDataSource } from '../config/database.config.js';
import { BoostAttempt } from '../entities/BoostAttempt.entity.js';
import { BoostLevelProgress } from '../entities/BoostLevelProgress.entity.js';
import { BoostProfile } from '../entities/BoostProfile.entity.js';
import { MemberPointsLedger } from '../entities/MemberPointsLedger.entity.js';
import { BoostError } from '../utils/boost-response.util.js';
import { dateKeyIn, nextMidnightIn, shiftDateKey, ms } from '../utils/boost-date.util.js';
import { logger } from '../utils/logger.util.js';
import {
  buildLevel,
  toClient,
  scoreAttempt,
  CATEGORIES,
  CATEGORY_BY_KEY,
  LEVELS,
  MAX_LEVEL,
  PASS_MARK,
  QUESTIONS_PER_LEVEL,
  isKnownCategory,
  isKnownLevel,
  type ServerQuestion
} from '../utils/boost-engine.util.js';
import type {
  AttemptResult,
  CategorySummary,
  ClientAttempt,
  LevelStatus,
  TodayState
} from '../types/boost.types.js';

/**
 * Boost My IQ — the daily quiz.
 *
 * Every rule the front end displays is enforced here; the client's copy is for
 * showing the right button, not for deciding anything. See `API.md` for the
 * rules table this implements.
 *
 * The questions themselves are never stored. An attempt keeps its `seed`, and
 * `buildLevel()` rebuilds the same twenty questions on every read and once more
 * to mark them, so the answer key exists only for the length of a request.
 */

const POINTS_PER_CORRECT = 2;
/** Multiplied by the level, and only the first time that level is completed. */
const COMPLETION_BONUS = 100;

/** How long a practice run may stay open. Practice is not bound to the daily reset. */
const PRACTICE_TTL_MS = 24 * 60 * 60 * 1000;

const attemptRepo = () => AppDataSource.getRepository(BoostAttempt);
const progressRepo = () => AppDataSource.getRepository(BoostLevelProgress);
const profileRepo = () => AppDataSource.getRepository(BoostProfile);
const ledgerRepo = () => AppDataSource.getRepository(MemberPointsLedger);

const publicId = (): string => `att_${crypto.randomBytes(6).toString('hex')}`;

/** Postgres unique-violation. Two tabs starting a quiz at once land here. */
const isUniqueViolation = (e: any): boolean => e?.code === '23505' || e?.driverError?.code === '23505';

/* ── progression ──────────────────────────────────────────────────────────── */

type ProgressMap = Map<string, BoostLevelProgress>;

const progressKey = (category: string, level: number) => `${category}:${level}`;

async function loadProgress(customerId: string): Promise<ProgressMap> {
  const rows = await progressRepo().find({ where: { customer_id: customerId } });
  return new Map(rows.map((r) => [progressKey(r.category, r.level), r]));
}

const completedLevels = (progress: ProgressMap, category: string): number[] =>
  LEVELS.map((l) => l.level).filter((level) => progress.get(progressKey(category, level))?.passed_at);

/**
 * The highest level the member may play: one past their highest consecutive
 * pass. Level 1 is always open, and a failed level stays unlocked.
 */
function highestUnlocked(progress: ProgressMap, category: string): number {
  const done = new Set(completedLevels(progress, category));
  let level = 1;
  while (done.has(level) && level < MAX_LEVEL) level += 1;
  return level;
}

function levelStatus(progress: ProgressMap, category: string, level: number): LevelStatus {
  if (progress.get(progressKey(category, level))?.passed_at) return 'completed';
  return level <= highestUnlocked(progress, category) ? 'available' : 'locked';
}

function categorySummary(progress: ProgressMap, category: (typeof CATEGORIES)[number]): CategorySummary {
  const done = completedLevels(progress, category.key);

  return {
    key: category.key,
    label: category.label,
    blurb: category.blurb,
    skills: category.skills,
    unscored: Boolean(category.unscored),
    completedLevels: done.length,
    currentLevel: highestUnlocked(progress, category.key),
    mastered: done.length === MAX_LEVEL,
    levels: LEVELS.map(({ level, name }) => {
      const row = progress.get(progressKey(category.key, level));
      return {
        level,
        name,
        status: levelStatus(progress, category.key, level),
        attempts: row?.attempts_count ?? 0,
        best: row?.best_score ?? null,
        lastScore: row?.last_score ?? null,
        completedAt: ms(row?.passed_at ?? null)
      };
    })
  };
}

/* ── today ────────────────────────────────────────────────────────────────── */

/** Today's scored attempt, if the member has started one. Practice is excluded. */
async function findTodaysAttempt(customerId: string, dateKey: string): Promise<BoostAttempt | null> {
  return attemptRepo().findOne({
    where: { customer_id: customerId, date_key: dateKey, is_practice: false }
  });
}

function todayStateFrom(dateKey: string, attempt: BoostAttempt | null): TodayState {
  if (!attempt) {
    return { dateKey, status: 'available', attempt: null, result: null };
  }

  const done = attempt.status === 'submitted';

  return {
    dateKey,
    status: done ? 'done' : 'in_progress',
    attempt: { id: attempt.public_id, category: attempt.category, level: attempt.level },
    result: done
      ? {
          category: attempt.category,
          level: attempt.level,
          correct: attempt.correct,
          total: attempt.total,
          passed: attempt.passed,
          unscored: attempt.unscored,
          points: attempt.points
        }
      : null
  };
}

/* ── serialising an attempt for the client ────────────────────────────────── */

const questionsOf = (attempt: BoostAttempt): ServerQuestion[] =>
  buildLevel(attempt.category, attempt.level, attempt.seed);

/**
 * The attempt as the client may see it.
 *
 * `seed` is pointedly absent: with it, a member could rebuild the questions
 * locally, run the generator's own answer key over them and submit a perfect
 * score. It is the single most important field never to serialise.
 */
function toClientAttempt(attempt: BoostAttempt, withQuestions: boolean): ClientAttempt {
  const base: ClientAttempt = {
    id: attempt.public_id,
    category: attempt.category,
    level: attempt.level,
    dateKey: attempt.date_key,
    startedAt: attempt.started_at.getTime(),
    status: attempt.status
  };

  if (attempt.is_practice) base.practice = true;

  if (withQuestions) {
    base.questions = questionsOf(attempt).map(toClient);
    // Where the member was, so a resume on another device lands in the right
    // place with the answers they already gave.
    base.progress = {
      index: attempt.current_index,
      answers: attempt.answers ?? {},
      studied: attempt.studied ?? [],
      timing: attempt.timing_ms ?? {}
    };
  }

  return base;
}

/** Expiry, told apart so the member gets the reason that actually applies. */
function assertOpen(attempt: BoostAttempt): void {
  if (attempt.status === 'submitted') {
    throw new BoostError(409, 'already_submitted', 'This quiz has already been submitted.');
  }
  if (attempt.status !== 'in_progress') {
    throw new BoostError(410, 'attempt_closed', 'This attempt is no longer open.');
  }
  if (attempt.expires_at.getTime() <= Date.now()) {
    if (attempt.is_practice) {
      throw new BoostError(410, 'attempt_closed', 'This practice run has been closed. Start another any time.');
    }
    throw new BoostError(
      410,
      'attempt_expired',
      'This quiz expired at midnight. Today’s quiz is ready for you.'
    );
  }
}

/** Flips a lapsed row to `expired` so reports do not count it as still running. */
async function closeIfLapsed(attempt: BoostAttempt): Promise<void> {
  if (attempt.status === 'in_progress' && attempt.expires_at.getTime() <= Date.now()) {
    attempt.status = 'expired';
    await attemptRepo().save(attempt);
  }
}

/* ── GET /boost ───────────────────────────────────────────────────────────── */

export async function getOverview(customerId: string, timezone: string) {
  const dateKey = dateKeyIn(timezone);

  const [progress, todays, personality] = await Promise.all([
    loadProgress(customerId),
    findTodaysAttempt(customerId, dateKey),
    latestPersonalityProfile(customerId)
  ]);

  if (todays) await closeIfLapsed(todays);

  return {
    today: todayStateFrom(dateKey, todays),
    resetsAt: nextMidnightIn(timezone).getTime(),
    passMark: PASS_MARK,
    questionsPerLevel: QUESTIONS_PER_LEVEL,
    levels: LEVELS,
    categories: CATEGORIES.map((c) => categorySummary(progress, c)),
    personality
  };
}

/**
 * The member's Big Five profile — their most recent completed personality level.
 *
 * Rebuilt from nothing: the traits were cached on the attempt when it was
 * submitted, precisely so this read does not have to regenerate twenty
 * statements to answer "what is my profile".
 */
async function latestPersonalityProfile(customerId: string) {
  const attempt = await attemptRepo().findOne({
    where: { customer_id: customerId, category: 'personality', status: 'submitted' },
    order: { submitted_at: 'DESC' }
  });

  if (!attempt?.profile) return null;

  return { traits: attempt.profile, level: attempt.level, at: ms(attempt.submitted_at) };
}

/* ── POST /boost/attempts ─────────────────────────────────────────────────── */

export interface StartResult {
  resumed: boolean;
  attempt: ClientAttempt;
}

export async function startAttempt(
  customerId: string,
  timezone: string,
  rawCategory: unknown,
  rawLevel: unknown
): Promise<StartResult> {
  const category = String(rawCategory ?? '');
  const level = Number(rawLevel);

  if (!isKnownCategory(category)) {
    throw new BoostError(404, 'unknown_category', 'That category does not exist.');
  }
  if (!Number.isInteger(level) || !isKnownLevel(level)) {
    throw new BoostError(422, 'unknown_level', 'That level does not exist.');
  }

  const dateKey = dateKeyIn(timezone);
  const progress = await loadProgress(customerId);

  // 1. A completed level can always be replayed as practice — even after
  //    today's quiz is used. Practice spends no daily slot and earns nothing,
  //    so it cannot be farmed for the leaderboard.
  if (levelStatus(progress, category, level) === 'completed') {
    return startPractice(customerId, timezone, category, level, dateKey);
  }

  // 2. The daily slot. Checked before the lock, deliberately: a member who has
  //    already played today should be told that, not told the level is locked.
  const todays = await findTodaysAttempt(customerId, dateKey);

  if (todays) {
    await closeIfLapsed(todays);

    if (todays.status === 'in_progress') {
      if (todays.category === category && todays.level === level) {
        return { resumed: true, attempt: toClientAttempt(todays, true) };
      }
      throw new BoostError(
        409,
        'attempt_in_progress',
        'You already have a quiz in progress today. Finish it first.',
        { attempt: { id: todays.public_id, category: todays.category, level: todays.level } }
      );
    }

    throw new BoostError(
      409,
      'daily_limit_reached',
      'You have already taken today’s quiz. Come back tomorrow for the next one.',
      { resetsAt: nextMidnightIn(timezone).getTime() }
    );
  }

  // 3. Levels unlock in order.
  if (levelStatus(progress, category, level) === 'locked') {
    throw new BoostError(
      403,
      'level_locked',
      `Score ${PASS_MARK} or more on level ${level - 1} to unlock level ${level}.`
    );
  }

  const row = await bumpStarts(customerId, category, level);

  const attempt = attemptRepo().create({
    public_id: publicId(),
    customer_id: customerId,
    category,
    level,
    // Moves with every start, so a retry of the same level is a fresh set of
    // questions at the same difficulty rather than the same twenty again.
    seed: `${customerId}:${row.starts_count}:${dateKey}`,
    date_key: dateKey,
    is_practice: false,
    status: 'in_progress',
    current_index: 0,
    answers: {},
    studied: [],
    timing_ms: {},
    started_at: new Date(),
    // Starting spends the day whether or not this is ever submitted — otherwise
    // a member could open a level, read the questions and back out.
    expires_at: nextMidnightIn(timezone),
    unscored: Boolean(CATEGORY_BY_KEY[category]?.unscored)
  });

  try {
    const saved = await attemptRepo().save(attempt);
    return { resumed: false, attempt: toClientAttempt(saved, true) };
  } catch (error: any) {
    if (!isUniqueViolation(error)) throw error;

    // Two tabs pressed start together. The unique index on
    // (customer_id, date_key) settled it; whoever lost re-reads the winner.
    const winner = await findTodaysAttempt(customerId, dateKey);
    if (winner && winner.category === category && winner.level === level) {
      return { resumed: true, attempt: toClientAttempt(winner, true) };
    }
    throw new BoostError(
      409,
      'attempt_in_progress',
      'You already have a quiz in progress today. Finish it first.',
      winner
        ? { attempt: { id: winner.public_id, category: winner.category, level: winner.level } }
        : undefined
    );
  }
}

/**
 * A replay of a completed level.
 *
 * One practice run is open at a time: starting another closes the previous one,
 * so a member cannot hold a dozen sets of questions open and cherry-pick.
 */
async function startPractice(
  customerId: string,
  timezone: string,
  category: string,
  level: number,
  dateKey: string
): Promise<StartResult> {
  const open = await attemptRepo().findOne({
    where: { customer_id: customerId, is_practice: true, status: 'in_progress' },
    order: { started_at: 'DESC' }
  });

  if (open && open.expires_at.getTime() > Date.now()) {
    if (open.category === category && open.level === level) {
      return { resumed: true, attempt: toClientAttempt(open, true) };
    }
  }

  if (open) {
    open.status = 'abandoned';
    await attemptRepo().save(open);
  }

  const row = await bumpStarts(customerId, category, level);

  const attempt = attemptRepo().create({
    public_id: publicId(),
    customer_id: customerId,
    category,
    level,
    seed: `${customerId}:p${row.starts_count}:${Date.now()}`,
    date_key: dateKey,
    is_practice: true,
    status: 'in_progress',
    current_index: 0,
    answers: {},
    studied: [],
    timing_ms: {},
    started_at: new Date(),
    expires_at: new Date(Date.now() + PRACTICE_TTL_MS),
    unscored: Boolean(CATEGORY_BY_KEY[category]?.unscored)
  });

  const saved = await attemptRepo().save(attempt);
  return { resumed: false, attempt: toClientAttempt(saved, true) };
}

/** Counts the start and returns the row, creating it the first time. */
async function bumpStarts(
  customerId: string,
  category: string,
  level: number
): Promise<BoostLevelProgress> {
  const repo = progressRepo();
  let row = await repo.findOne({ where: { customer_id: customerId, category, level } });

  if (!row) {
    row = repo.create({
      customer_id: customerId,
      category,
      level,
      starts_count: 0,
      attempts_count: 0,
      best_score: null,
      last_score: null,
      passed_at: null
    });
  }

  row.starts_count += 1;

  try {
    return await repo.save(row);
  } catch (error: any) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await repo.findOne({ where: { customer_id: customerId, category, level } });
    if (!raced) throw error;
    raced.starts_count += 1;
    return repo.save(raced);
  }
}

/* ── reading an attempt ───────────────────────────────────────────────────── */

async function ownedAttempt(customerId: string, attemptPublicId: string): Promise<BoostAttempt> {
  const attempt = await attemptRepo().findOne({
    where: { public_id: attemptPublicId, customer_id: customerId }
  });

  // Scoped to the caller, so another member's attempt id is indistinguishable
  // from one that does not exist.
  if (!attempt) throw new BoostError(404, 'not_found', 'That attempt does not exist.');

  return attempt;
}

export async function getCurrentAttempt(customerId: string, timezone: string) {
  const dateKey = dateKeyIn(timezone);
  const attempt = await findTodaysAttempt(customerId, dateKey);

  if (!attempt) {
    throw new BoostError(404, 'no_attempt_today', 'You have not started a quiz today.');
  }

  await closeIfLapsed(attempt);
  return attemptPayload(attempt);
}

export async function getAttempt(customerId: string, attemptPublicId: string) {
  const attempt = await ownedAttempt(customerId, attemptPublicId);
  await closeIfLapsed(attempt);
  return attemptPayload(attempt);
}

/** Questions while it is open, the result once it is done — so a reload works either way. */
function attemptPayload(attempt: BoostAttempt) {
  if (attempt.status === 'submitted') {
    return { attempt: toClientAttempt(attempt, false), result: rebuildResult(attempt) };
  }

  if (attempt.status !== 'in_progress') {
    throw new BoostError(410, 'attempt_closed', 'This attempt is no longer open.');
  }

  return { attempt: toClientAttempt(attempt, true), result: null };
}

/**
 * The result of a submitted attempt, rebuilt rather than stored.
 *
 * The review carries every prompt, every option and every explanation — roughly
 * ten kilobytes an attempt. Since the seed regenerates the questions exactly and
 * the answers are already on the row, storing it would be keeping a copy of
 * something we can always derive.
 */
function rebuildResult(attempt: BoostAttempt): AttemptResult {
  const questions = questionsOf(attempt);
  const scored = scoreAttempt(attempt.category, questions, attempt.answers ?? {});

  return {
    category: attempt.category,
    level: attempt.level,
    correct: attempt.correct ?? scored.correct,
    total: attempt.total ?? scored.total,
    passMark: PASS_MARK,
    passed: attempt.passed ?? scored.passed,
    unscored: attempt.unscored,
    firstCompletion: attempt.first_completion,
    alreadyCompleted: Boolean(attempt.passed) && !attempt.first_completion,
    levelCompleted: Boolean(attempt.passed) || attempt.first_completion,
    nextUnlocked: attempt.first_completion && attempt.level < MAX_LEVEL ? attempt.level + 1 : null,
    mastered: false,
    practice: attempt.is_practice,
    points: attempt.points,
    profile: attempt.profile,
    review: scored.review
  };
}

/* ── PATCH /boost/attempts/:id/progress ───────────────────────────────────── */

export interface ProgressPatch {
  index?: unknown;
  answers?: unknown;
  studied?: unknown;
  timing?: unknown;
}

const QUESTION_ID = /^q([1-9]|1[0-9]|20)$/;
/** Likert runs 0–4; multiple choice never exceeds it. */
const MAX_OPTION_INDEX = 4;
/** An hour on one question is already implausible; beyond that it is a broken clock. */
const MAX_QUESTION_MS = 60 * 60 * 1000;

/**
 * Autosaved as the member plays, so a quiz resumes on any device.
 *
 * Everything is bounded before it is stored: this is member-supplied JSON going
 * into a JSONB column, and none of it is trusted. It is also never used to
 * score — submit rebuilds the questions and marks them server-side — so the
 * worst a forged payload can do is give its author a confusing resume.
 */
export async function saveProgress(
  customerId: string,
  attemptPublicId: string,
  patch: ProgressPatch
): Promise<void> {
  const attempt = await ownedAttempt(customerId, attemptPublicId);
  assertOpen(attempt);

  if (Number.isInteger(Number(patch.index))) {
    attempt.current_index = Math.min(Math.max(Number(patch.index), 0), QUESTIONS_PER_LEVEL - 1);
  }

  if (patch.answers && typeof patch.answers === 'object') {
    const clean: Record<string, number> = {};
    for (const [id, value] of Object.entries(patch.answers as Record<string, unknown>)) {
      const choice = Number(value);
      if (!QUESTION_ID.test(id)) continue;
      if (!Number.isInteger(choice) || choice < 0 || choice > MAX_OPTION_INDEX) continue;
      clean[id] = choice;
    }
    attempt.answers = clean;
  }

  if (Array.isArray(patch.studied)) {
    attempt.studied = Array.from(
      new Set((patch.studied as unknown[]).map(String).filter((id) => QUESTION_ID.test(id)))
    ).slice(0, QUESTIONS_PER_LEVEL);
  }

  if (patch.timing && typeof patch.timing === 'object') {
    const clean: Record<string, number> = {};
    for (const [id, value] of Object.entries(patch.timing as Record<string, unknown>)) {
      const spent = Number(value);
      if (!QUESTION_ID.test(id)) continue;
      if (!Number.isFinite(spent) || spent < 0) continue;
      clean[id] = Math.min(Math.round(spent), MAX_QUESTION_MS);
    }
    attempt.timing_ms = clean;
  }

  attempt.last_activity_at = new Date();
  await attemptRepo().save(attempt);
}

/* ── POST /boost/attempts/:id/submit ──────────────────────────────────────── */

export interface SubmitOutcome {
  result: AttemptResult;
  streak: number;
}

export async function submitAttempt(
  customerId: string,
  timezone: string,
  attemptPublicId: string,
  rawAnswers: unknown
): Promise<SubmitOutcome> {
  const attempt = await ownedAttempt(customerId, attemptPublicId);
  assertOpen(attempt);

  // The autosaved answers are the floor: a final payload that arrives partial —
  // a flaky connection on the last question — must not discard what the member
  // already answered.
  const submitted =
    rawAnswers && typeof rawAnswers === 'object' ? (rawAnswers as Record<string, unknown>) : {};

  const answers: Record<string, number> = { ...(attempt.answers ?? {}) };
  for (const [id, value] of Object.entries(submitted)) {
    const choice = Number(value);
    if (!QUESTION_ID.test(id)) continue;
    if (!Number.isInteger(choice) || choice < 0 || choice > MAX_OPTION_INDEX) continue;
    answers[id] = choice;
  }

  // Rebuilt from the seed, here on the server. The client's answers are indices;
  // what they are indices *into* is decided here and nowhere else.
  const questions = questionsOf(attempt);
  const scored = scoreAttempt(attempt.category, questions, answers);

  const progress = await loadProgress(customerId);
  const row =
    progress.get(progressKey(attempt.category, attempt.level)) ??
    (await bumpStarts(customerId, attempt.category, attempt.level));

  const firstCompletion = scored.passed && !row.passed_at;

  row.attempts_count += 1;
  row.last_score = scored.correct;
  row.best_score = Math.max(row.best_score ?? 0, scored.correct);
  if (firstCompletion) row.passed_at = new Date();
  await progressRepo().save(row);

  // Practice always earns nothing — the rule that stops a completed level being
  // replayed for points.
  const points = attempt.is_practice
    ? 0
    : scored.correct * POINTS_PER_CORRECT + (firstCompletion ? COMPLETION_BONUS * attempt.level : 0);

  const now = new Date();
  attempt.status = 'submitted';
  attempt.submitted_at = now;
  attempt.duration_ms = now.getTime() - attempt.started_at.getTime();
  attempt.answers = answers;
  attempt.correct = scored.correct;
  attempt.total = scored.total;
  attempt.passed = scored.passed;
  attempt.unscored = Boolean(scored.unscored);
  attempt.first_completion = firstCompletion;
  attempt.points = points;
  attempt.profile = scored.profile ?? null;
  await attemptRepo().save(attempt);

  if (points > 0) await awardPoints(customerId, attempt, points);

  const profile = await profileRepo().findOne({ where: { customer_id: customerId } });
  let streak = profile?.streak ?? 0;

  if (profile) {
    if (points > 0) profile.total_points += points;
    // Practice does not touch the streak: it is not a day's training.
    if (!attempt.is_practice) {
      streak = await recomputeStreak(customerId, timezone);
      profile.streak = streak;
      profile.longest_streak = Math.max(profile.longest_streak, streak);
    }
    await profileRepo().save(profile);
  }

  const refreshed = await loadProgress(customerId);

  return {
    streak,
    result: {
      category: attempt.category,
      level: attempt.level,
      correct: scored.correct,
      total: scored.total,
      passMark: PASS_MARK,
      passed: scored.passed,
      unscored: Boolean(scored.unscored),
      firstCompletion,
      alreadyCompleted: scored.passed && !firstCompletion,
      levelCompleted: Boolean(row.passed_at),
      nextUnlocked: firstCompletion && attempt.level < MAX_LEVEL ? attempt.level + 1 : null,
      mastered: completedLevels(refreshed, attempt.category).length === MAX_LEVEL,
      practice: attempt.is_practice,
      points,
      profile: scored.profile ?? null,
      review: scored.review
    }
  };
}

/**
 * Writes the points award.
 *
 * The unique index on (source, ref_id) means a retried submit cannot pay twice,
 * so this is safe to call without wrapping the whole submit in a transaction.
 */
async function awardPoints(customerId: string, attempt: BoostAttempt, points: number): Promise<void> {
  try {
    await ledgerRepo().save(
      ledgerRepo().create({
        customer_id: customerId,
        source: 'boost',
        ref_id: attempt.id,
        points,
        date_key: attempt.date_key
      })
    );
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      logger.warn(`Points for attempt ${attempt.id} were already awarded — ignoring the repeat.`);
      return;
    }
    throw error;
  }
}

/**
 * Consecutive days of training, counted back from today in the member's own
 * calendar.
 *
 * Today not being done yet is not a broken streak — it is the middle of the
 * day. Anything earlier missing is.
 */
export async function recomputeStreak(customerId: string, timezone: string): Promise<number> {
  const today = dateKeyIn(timezone);
  const earliest = shiftDateKey(today, -400);

  const rows = await attemptRepo()
    .createQueryBuilder('a')
    .select('DISTINCT a.date_key', 'date_key')
    .where('a.customer_id = :customerId', { customerId })
    .andWhere('a.is_practice = false')
    .andWhere('a.status = :status', { status: 'submitted' })
    .andWhere('a.date_key >= :earliest', { earliest })
    .getRawMany<{ date_key: string }>();

  const done = new Set(rows.map((r) => r.date_key));

  let streak = 0;
  for (let back = 0; back < 400; back += 1) {
    const key = shiftDateKey(today, -back);
    if (done.has(key)) streak += 1;
    else if (back > 0) break;
  }

  return streak;
}

/** Shared with the dashboard and report, which summarise the same rows. */
export const boostProgression = {
  loadProgress,
  categorySummary,
  completedLevels,
  highestUnlocked,
  findTodaysAttempt,
  todayStateFrom,
  latestPersonalityProfile
};

export { PASS_MARK, QUESTIONS_PER_LEVEL, CATEGORIES, LEVELS };
