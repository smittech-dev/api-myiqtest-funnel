/**
 * Boost engine checks.
 *
 *   npm run check:boost
 *
 * 1. Parity — every file in src/boost-engine is still identical to the frontend
 *    original it was copied from, with the `.js` import extensions normalised
 *    away. A generator tweaked on one side and forgotten on the other would
 *    otherwise mean the questions a member is shown and the answer key used to
 *    mark them come from two different versions of the same code.
 *
 * 2. Structure — every level of every category, across many seeds, builds
 *    twenty well-formed questions with a valid answer index.
 *
 * 3. Leakage — toClient() output carries no answer, explanation, trait or key.
 *    This is the check that stops a refactor quietly publishing the answer key.
 *
 * Exits non-zero on any failure, so it can run in CI alongside the build.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { buildLevel, scoreAttempt, toClient, CATEGORIES, LEVELS, QUESTIONS_PER_LEVEL, PASS_MARK } from '../src/boost-engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(here, '..', 'src', 'boost-engine');
const FRONTEND_DIR = join(here, '..', '..', 'boost.myiq-test.com', 'src', 'data', 'boost');
const CATALOG_COPY = join(here, '..', 'src', 'boost-demo', 'catalog.js');
const CATALOG_SOURCE = join(here, '..', '..', 'boost.myiq-test.com', 'src', 'data', 'catalog.js');

const SEEDS = Number(process.env.SEEDS || 40);
const problems = [];
const fail = (msg) => problems.push(msg);

/* ── 1. parity with the frontend original ─────────────────────────────────── */

// The only permitted difference: Node needs the extension, the bundler does not.
const normalise = (src) =>
  src.replace(/from '\.\/([a-z]+)\.js'/g, "from './$1'").replace(/\r\n/g, '\n').trimEnd();

const digest = (src) => createHash('sha256').update(normalise(src)).digest('hex');

if (!existsSync(FRONTEND_DIR)) {
  console.log(`- parity skipped: frontend not checked out at ${FRONTEND_DIR}`);
} else {
  const engineFiles = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'));
  const frontendFiles = readdirSync(FRONTEND_DIR).filter((f) => f.endsWith('.js'));

  for (const f of frontendFiles) {
    if (!engineFiles.includes(f)) fail(`parity: ${f} exists in the frontend but not in src/boost-engine`);
  }
  for (const f of engineFiles) {
    if (!frontendFiles.includes(f)) {
      fail(`parity: ${f} exists in src/boost-engine but not in the frontend`);
      continue;
    }
    const a = digest(readFileSync(join(ENGINE_DIR, f), 'utf8'));
    const b = digest(readFileSync(join(FRONTEND_DIR, f), 'utf8'));
    if (a !== b) fail(`parity: ${f} has drifted from the frontend original — re-copy it`);
  }
  if (!problems.length) console.log(`- parity: ${engineFiles.length} files identical to the frontend`);

  // The game catalogue is copied for the same reason and drifts the same way:
  // the server decides what counts as a personal best, so its idea of
  // `lowerIsBetter` has to be the client's.
  if (existsSync(CATALOG_SOURCE)) {
    if (digest(readFileSync(CATALOG_COPY, 'utf8')) !== digest(readFileSync(CATALOG_SOURCE, 'utf8'))) {
      fail('parity: src/boost-demo/catalog.js has drifted from the frontend original — re-copy it');
    } else {
      console.log('- parity: game catalogue identical to the frontend');
    }
  }
}

/* ── 2 & 3. generation and leakage ────────────────────────────────────────── */

const LEAKED = ['answer', 'explain', 'trait', 'key'];
let built = 0;

for (const c of CATEGORIES) {
  for (const { level } of LEVELS) {
    for (let s = 0; s < SEEDS; s++) {
      const where = `${c.key} L${level} seed${s}`;
      const qs = buildLevel(c.key, level, `s${s}`);
      built++;

      if (qs.length !== QUESTIONS_PER_LEVEL) {
        fail(`${where}: ${qs.length} questions, expected ${QUESTIONS_PER_LEVEL}`);
        continue;
      }

      const ids = new Set(qs.map((q) => q.id));
      if (ids.size !== qs.length) fail(`${where}: duplicate question ids`);

      for (const q of qs) {
        if (!q.prompt) fail(`${where}: question ${q.id} has no prompt`);
        if (!Array.isArray(q.options) || q.options.length < 2) fail(`${where}: ${q.id} has too few options`);

        const opts = q.options.map((o) => (typeof o === 'object' ? JSON.stringify(o) : String(o)));
        if (opts.some((o) => o === 'undefined' || o === 'null' || o === '' || o.includes('NaN'))) {
          fail(`${where}: ${q.id} has a malformed option [${opts}]`);
        }

        if (q.type === 'choice') {
          if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
            fail(`${where}: ${q.id} answer index ${q.answer} is out of range`);
          }
          if (new Set(opts).size !== opts.length) fail(`${where}: ${q.id} has duplicate options`);
        } else if (q.type === 'likert') {
          if (!q.trait || !q.key) fail(`${where}: ${q.id} is a likert with no trait/key`);
        } else {
          fail(`${where}: ${q.id} has unknown type "${q.type}"`);
        }

        // The whole point of running this on the server.
        const sent = toClient(q);
        for (const banned of LEAKED) {
          if (banned in sent) fail(`LEAK: ${where} ${q.id} — toClient() exposed "${banned}"`);
        }
      }
    }
  }
}

/* ── scoring sanity ───────────────────────────────────────────────────────── */

{
  const qs = buildLevel('numerical', 1, 'scoring-check');
  const allRight = Object.fromEntries(qs.map((q) => [q.id, q.answer]));
  const perfect = scoreAttempt('numerical', qs, allRight);
  if (perfect.correct !== QUESTIONS_PER_LEVEL) fail(`scoring: a fully correct run scored ${perfect.correct}`);
  if (!perfect.passed) fail('scoring: a fully correct run did not pass');

  const allWrong = Object.fromEntries(qs.map((q) => [q.id, (q.answer + 1) % q.options.length]));
  const zero = scoreAttempt('numerical', qs, allWrong);
  if (zero.correct !== 0) fail(`scoring: a fully wrong run scored ${zero.correct}`);
  if (zero.passed) fail('scoring: a fully wrong run passed');

  const empty = scoreAttempt('numerical', qs, {});
  if (empty.correct !== 0) fail('scoring: an unanswered run did not score 0');

  // Personality passes on completion, never on correctness.
  const pq = buildLevel('personality', 1, 'scoring-check');
  const done = scoreAttempt('personality', pq, Object.fromEntries(pq.map((q) => [q.id, 2])));
  if (!done.passed || !done.unscored) fail('scoring: a completed personality level did not pass as unscored');
  if (!done.profile || Object.keys(done.profile).length !== 5) fail('scoring: personality profile is not five traits');
  const partial = scoreAttempt('personality', pq, { [pq[0].id]: 1 });
  if (partial.passed) fail('scoring: a partly answered personality level passed');
}

/* ── report ───────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  process.exit(1);
}

console.log(`- generated ${built} levels across ${CATEGORIES.length} categories × ${LEVELS.length} levels × ${SEEDS} seeds`);
console.log(`- no answer key reachable through toClient()`);
console.log(`- pass mark ${PASS_MARK}/${QUESTIONS_PER_LEVEL}`);
console.log('\n✓ boost engine OK');
