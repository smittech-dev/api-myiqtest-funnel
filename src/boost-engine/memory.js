import { choice, LETTERS } from './util.js';

/**
 * Memory and recall. Every question has a `study` phase that is shown for a
 * fixed time and then hidden before the question appears. Difficulty rises
 * through span length, shorter exposure, and recall that has to be
 * transformed (reversed, cross-referenced, summed) rather than just repeated.
 */

const WORDS = [
  'apple', 'river', 'candle', 'mirror', 'garden', 'pencil', 'rocket', 'jacket', 'violin', 'bridge',
  'coffee', 'island', 'ladder', 'magnet', 'orange', 'pillow', 'saddle', 'tunnel', 'wallet', 'anchor',
  'basket', 'cactus', 'dragon', 'engine', 'feather', 'guitar', 'helmet', 'kettle', 'lemon', 'marble',
  'needle', 'otter', 'parrot', 'quartz', 'ribbon', 'spider', 'tomato', 'umbrella', 'velvet', 'window',
  'zebra', 'bottle', 'castle', 'desert', 'forest', 'glove', 'hammer', 'iceberg', 'jungle', 'lantern',
];

const PARAMS = {
  1: { span: 4, words: 4, grid: 3, lit: 3, pairs: 3, pace: 1.3, kinds: ['forward', 'position', 'absent', 'gridCount'] },
  2: { span: 5, words: 5, grid: 4, lit: 4, pairs: 3, pace: 1.15, kinds: ['forward', 'position', 'absent', 'gridCount', 'gridWhich'] },
  3: { span: 6, words: 6, grid: 4, lit: 5, pairs: 4, pace: 1.0, kinds: ['forward', 'backward', 'position', 'absent', 'gridWhich'] },
  4: { span: 7, words: 7, grid: 5, lit: 6, pairs: 4, pace: 0.9, kinds: ['backward', 'position', 'absent', 'pairs', 'gridWhich'] },
  5: { span: 8, words: 8, grid: 5, lit: 7, pairs: 5, pace: 0.8, kinds: ['backward', 'pairs', 'digitSum', 'position', 'gridWhich'] },
};

const studyMs = (items, pace) => Math.round((1600 + items * 650) * pace);
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

function digits(r, n) {
  const out = [];
  while (out.length < n) {
    const d = r.int(0, 9);
    if (d !== out[out.length - 1]) out.push(d);
  }
  return out;
}

/** Plausible wrong recalls of a digit list. */
function digitVariants(r, xs) {
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const s = [...xs];
    [s[i], s[i + 1]] = [s[i + 1], s[i]];
    out.push(s);
  }
  for (let k = 0; k < 4; k++) {
    const s = [...xs];
    const i = r.int(0, xs.length - 1);
    s[i] = (s[i] + r.int(1, 8)) % 10;
    out.push(s);
  }
  return out;
}

const join = (xs) => xs.join(' ');
const coord = (i, size) => `${LETTERS[Math.floor(i / size)]}${(i % size) + 1}`;

const T = {
  forward(r, p) {
    const xs = digits(r, p.span);
    return choice(r, {
      prompt: 'Which sequence did you just see?',
      study: { kind: 'seq', items: xs, ms: studyMs(p.span, p.pace) },
      answer: join(xs),
      distractors: digitVariants(r, xs).map(join),
      explain: `The sequence was ${join(xs)}.`,
      render: 'mono',
    });
  },

  backward(r, p) {
    const xs = digits(r, p.span);
    const rev = [...xs].reverse();
    return choice(r, {
      prompt: 'Which option is the sequence you saw, in reverse order?',
      study: { kind: 'seq', items: xs, ms: studyMs(p.span, p.pace) },
      answer: join(rev),
      distractors: [join(xs), ...digitVariants(r, rev).map(join)],
      explain: `You saw ${join(xs)}; reversed that is ${join(rev)}.`,
      render: 'mono',
    });
  },

  position(r, p) {
    const list = r.sample(WORDS, p.words);
    const k = r.int(0, p.words - 1);
    return choice(r, {
      prompt: `Which word was ${ORD[k]} in the list?`,
      study: { kind: 'words', items: list, ms: studyMs(p.words, p.pace) },
      answer: list[k],
      distractors: list.filter((_, i) => i !== k),
      explain: `The list was: ${list.join(', ')}.`,
    });
  },

  absent(r, p) {
    const pool = r.sample(WORDS, p.words + 1);
    const list = pool.slice(0, p.words);
    const missing = pool[p.words];
    return choice(r, {
      prompt: 'Which word was NOT in the list?',
      study: { kind: 'words', items: list, ms: studyMs(p.words, p.pace) },
      answer: missing,
      distractors: list,
      explain: `The list was: ${list.join(', ')}. "${missing}" was not in it.`,
    });
  },

  gridCount(r, p) {
    const lit = r.sample([...Array(p.grid * p.grid).keys()], p.lit);
    return choice(r, {
      prompt: 'How many squares were lit?',
      study: { kind: 'grid', size: p.grid, lit, ms: studyMs(p.lit, p.pace) },
      answer: String(p.lit),
      distractors: [p.lit - 1, p.lit + 1, p.lit + 2, p.lit - 2].filter((v) => v > 0).map(String),
      explain: `${p.lit} squares were lit.`,
      render: 'mono',
    });
  },

  gridWhich(r, p) {
    const cells = [...Array(p.grid * p.grid).keys()];
    const lit = r.sample(cells, p.lit);
    const pick = r.pick(lit);
    const dark = cells.filter((c) => !lit.includes(c));
    return choice(r, {
      prompt: 'Which of these squares was lit?',
      study: { kind: 'grid', size: p.grid, lit, ms: studyMs(p.lit + 2, p.pace), labels: true },
      answer: coord(pick, p.grid),
      distractors: r.sample(dark, 5).map((c) => coord(c, p.grid)),
      explain: `Lit squares: ${lit.map((c) => coord(c, p.grid)).sort().join(', ')}.`,
      render: 'mono',
    });
  },

  pairs(r, p) {
    const words = r.sample(WORDS, p.pairs);
    const nums = r.sample([...Array(90).keys()].map((x) => x + 10), p.pairs);
    const items = words.map((w, i) => [w, nums[i]]);
    const k = r.int(0, p.pairs - 1);
    return choice(r, {
      prompt: `Which number was paired with "${words[k]}"?`,
      study: { kind: 'pairs', items, ms: studyMs(p.pairs * 2, p.pace) },
      answer: String(nums[k]),
      distractors: nums.filter((_, i) => i !== k).map(String).concat(String(nums[k] + 1)),
      explain: items.map(([w, n]) => `${w} → ${n}`).join(', '),
      render: 'mono',
    });
  },

  digitSum(r, p) {
    const xs = digits(r, p.span);
    const ans = xs[0] + xs[xs.length - 1];
    return choice(r, {
      prompt: 'What is the sum of the first and last digits you saw?',
      study: { kind: 'seq', items: xs, ms: studyMs(p.span, p.pace) },
      answer: String(ans),
      distractors: [xs[0] + xs[1], xs[xs.length - 2] + xs[xs.length - 1], ans + 1, ans - 1, ans + 2]
        .filter((v) => v >= 0)
        .map(String),
      explain: `${xs[0]} + ${xs[xs.length - 1]} = ${ans}.`,
      render: 'mono',
    });
  },
};

export function memory(r, level) {
  const p = PARAMS[level];
  return T[r.pick(p.kinds)](r, p);
}
