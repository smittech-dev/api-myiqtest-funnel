/**
 * Boost My IQ — the single daily-quiz system.
 *
 * Six categories × five levels × twenty questions. Questions are generated
 * from a seed, so a given attempt always rebuilds identically (the server only
 * needs to store the seed), while each new attempt at the same level gets a
 * fresh set at the same difficulty.
 *
 * Generation and scoring belong on the server: this module holds the answer
 * key. The client only ever receives `toClient()` output.
 */

import { rng } from './util.js';
import { numerical } from './numerical.js';
import { pattern } from './pattern.js';
import { memory } from './memory.js';
import { attention } from './attention.js';
import { verbal } from './verbal.js';
import { personalitySet, scoreTraits } from './personality.js';

export {
  CATEGORIES,
  CATEGORY_BY_KEY,
  LEVELS,
  PASS_MARK,
  QUESTIONS_PER_LEVEL,
  TRAITS,
} from './meta.js';
import { PASS_MARK, QUESTIONS_PER_LEVEL } from './meta.js';

const GENERATORS = { numerical, pattern, memory, attention, verbal };

const fingerprint = (q) => JSON.stringify([q.prompt, q.stimulus, q.study]);

/** Build the twenty questions for one attempt. Deterministic for a seed. */
export function buildLevel(category, level, seed) {
  const r = rng(`${category}:${level}:${seed}`);

  const questions =
    category === 'personality'
      ? personalitySet(r, level)
      : (() => {
          const gen = GENERATORS[category];
          const seen = new Set();
          const out = [];
          let guard = 0;
          while (out.length < QUESTIONS_PER_LEVEL && guard++ < 400) {
            const q = gen(r, level);
            const fp = fingerprint(q);
            if (seen.has(fp) || q.options.length < 2 || q.answer < 0) continue;
            seen.add(fp);
            out.push(q);
          }
          return out;
        })();

  return questions.map((q, i) => ({ ...q, id: `q${i + 1}`, category, level }));
}

/** Strip everything that would give the answer away. */
export function toClient(q) {
  const { answer, explain, key, trait, ...rest } = q;
  return rest;
}

/**
 * Score an attempt. `answers` maps question id → option index.
 * Personality has no right answers: a level passes once every statement is
 * answered, and the result carries a trait profile instead of a score.
 */
export function scoreAttempt(category, questions, answers) {
  const total = questions.length;

  if (category === 'personality') {
    const answered = questions.filter((q) => Number.isInteger(answers[q.id])).length;
    return {
      correct: answered,
      total,
      passed: answered === total,
      unscored: true,
      profile: scoreTraits(questions, answers),
      review: [],
    };
  }

  let correct = 0;
  const review = questions.map((q) => {
    const given = Number.isInteger(answers[q.id]) ? answers[q.id] : null;
    const right = given === q.answer;
    if (right) correct++;
    return {
      id: q.id,
      prompt: q.prompt,
      stimulus: q.stimulus,
      render: q.render,
      options: q.options,
      given,
      answer: q.answer,
      right,
      explain: q.explain,
    };
  });

  return { correct, total, passed: correct >= PASS_MARK, review };
}

