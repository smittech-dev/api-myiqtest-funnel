// @ts-ignore — plain JavaScript, copied verbatim from the frontend. See src/boost-engine/README.md.
import * as engine from '../boost-engine/index.js';
import type { ClientQuestion, ReviewItem } from '../types/boost.types.js';

/**
 * The one place the rest of the service touches the question generators.
 *
 * Everything below this line is untyped JavaScript on purpose — it is a
 * verbatim copy of the frontend's generators, and hand-porting it to TypeScript
 * would be how the two quietly diverge. This module puts a typed surface on it
 * and, more importantly, is the only import path, so the rule "the answer key
 * never leaves the server" has exactly one place to be broken and exactly one
 * place to be checked.
 */

/** A generated question, answer key and all. Never serialise one of these. */
export interface ServerQuestion {
  id: string;
  type: 'choice' | 'likert';
  prompt: string;
  stimulus?: unknown;
  study?: { kind: string; ms: number; [k: string]: unknown };
  render?: string;
  options: unknown[];
  /** The correct option index. */
  answer: number;
  explain?: string;
  /** Personality only. */
  trait?: string;
  key?: '+' | '-';
  category: string;
  level: number;
}

export interface ScoredAttempt {
  correct: number;
  total: number;
  passed: boolean;
  unscored?: boolean;
  profile?: Record<string, number>;
  review: ReviewItem[];
}

export interface CategoryMeta {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  skills: string[];
  unscored?: boolean;
}

export interface LevelMeta {
  level: number;
  name: string;
}

export const CATEGORIES: CategoryMeta[] = engine.CATEGORIES;
export const CATEGORY_BY_KEY: Record<string, CategoryMeta> = engine.CATEGORY_BY_KEY;
export const LEVELS: LevelMeta[] = engine.LEVELS;
export const PASS_MARK: number = engine.PASS_MARK;
export const QUESTIONS_PER_LEVEL: number = engine.QUESTIONS_PER_LEVEL;

/**
 * The twenty questions for one attempt. Deterministic: the same seed always
 * rebuilds the same set, which is why only the seed is stored.
 */
export function buildLevel(category: string, level: number, seed: string): ServerQuestion[] {
  return engine.buildLevel(category, level, seed) as ServerQuestion[];
}

/**
 * Strips `answer`, `explain`, `trait` and `key`.
 *
 * Every question sent to a client goes through here. `npm run check:boost`
 * asserts none of those four survive, on every build.
 */
export function toClient(q: ServerQuestion): ClientQuestion {
  return engine.toClient(q) as ClientQuestion;
}

/**
 * Marks an attempt. `answers` maps question id → chosen option index.
 * Personality is unscored: it passes once every statement is answered and
 * returns a trait profile instead of a mark.
 */
export function scoreAttempt(
  category: string,
  questions: ServerQuestion[],
  answers: Record<string, number>
): ScoredAttempt {
  return engine.scoreAttempt(category, questions, answers) as ScoredAttempt;
}

export const isKnownCategory = (key: string): boolean => Boolean(CATEGORY_BY_KEY[key]);
export const isKnownLevel = (level: number): boolean => LEVELS.some((l) => l.level === level);
export const MAX_LEVEL = LEVELS.length;
