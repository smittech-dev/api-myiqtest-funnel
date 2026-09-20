import { choice } from './util.js';

/**
 * Attention and focus: counting targets among look-alikes, comparing codes
 * character by character, spotting the odd one out and finding a missing
 * number. Difficulty rises through grid size, code length and how similar
 * the distractor glyphs are to the target.
 */

const GLYPHS = {
  1: [['★', '●'], ['▲', '■'], ['♥', '◆']],
  2: [['X', 'O'], ['T', 'L'], ['+', '×']],
  3: [['E', 'F'], ['M', 'N'], ['C', 'G']],
  4: [['6', '9'], ['b', 'd'], ['V', 'U']],
  5: [['q', 'p', 'd'], ['O', '0', 'Q'], ['l', '1', 'I']],
};

const PARAMS = {
  1: { grid: 4, code: 5, kinds: ['count', 'compare', 'odd'] },
  2: { grid: 5, code: 7, kinds: ['count', 'compare', 'odd', 'row'] },
  3: { grid: 6, code: 9, confuse: true, missingTo: 16, kinds: ['count', 'compare', 'odd', 'missing'] },
  4: { grid: 7, code: 11, confuse: true, missingTo: 20, kinds: ['count', 'compare', 'odd', 'missing', 'row'] },
  5: { grid: 8, code: 14, confuse: true, missingTo: 30, kinds: ['count', 'compare', 'odd', 'missing'] },
};

const PLAIN = 'ACDEFHJKMNPRTUVWXY34679';
const TRICKY = 'O0l1S5B8Z2';
const SWAP = { O: '0', 0: 'O', l: '1', 1: 'l', S: '5', 5: 'S', B: '8', 8: 'B', Z: '2', 2: 'Z' };

function makeCode(r, len, confuse) {
  const alpha = confuse ? PLAIN + TRICKY + TRICKY : PLAIN;
  return Array.from({ length: len }, () => r.pick(alpha)).join('');
}

/** Change `n` distinct positions — to a look-alike where one exists. */
function mutate(r, code, n, confuse) {
  const chars = [...code];
  const positions = r.sample([...chars.keys()], n);
  for (const i of positions) {
    const c = chars[i];
    if (confuse && SWAP[c]) chars[i] = SWAP[c];
    else {
      let next;
      do next = r.pick(PLAIN);
      while (next === c);
      chars[i] = next;
    }
  }
  return chars.join('');
}

const LABELS = ['A', 'B', 'C', 'D'];

const T = {
  count(r, p, level) {
    const set = r.pick(GLYPHS[level]);
    const [target, ...others] = set;
    const total = p.grid * p.grid;
    const n = r.int(Math.round(total * 0.12), Math.round(total * 0.3));
    const items = r.shuffle([
      ...Array(n).fill(target),
      ...Array.from({ length: total - n }, () => r.pick(others)),
    ]);
    return choice(r, {
      prompt: `How many “${target}” are in the grid?`,
      stimulus: { kind: 'glyphs', cols: p.grid, items },
      answer: String(n),
      distractors: [n - 1, n + 1, n - 2, n + 2].filter((v) => v >= 0).map(String),
      explain: `There are ${n}.`,
      render: 'mono',
    });
  },

  compare(r, p) {
    const a = makeCode(r, p.code, p.confuse);
    const diffs = r.int(0, 3);
    const b = mutate(r, a, diffs, p.confuse);
    const real = [...a].filter((c, i) => c !== b[i]).length;
    return choice(r, {
      prompt: 'How many characters are different between the two codes?',
      stimulus: { kind: 'codes', items: [a, b] },
      answer: String(real),
      distractors: ['0', '1', '2', '3', '4'],
      explain: real === 0 ? 'The codes are identical.' : `${real} position${real > 1 ? 's differ' : ' differs'}.`,
      render: 'mono',
    });
  },

  odd(r, p) {
    const base = makeCode(r, Math.max(4, p.code - 2), p.confuse);
    const odd = mutate(r, base, 1, p.confuse);
    const at = r.int(0, 3);
    const items = LABELS.map((_, i) => (i === at ? odd : base));
    // Letters stay in order — shuffling A–D would make the labels meaningless.
    return {
      type: 'choice',
      prompt: 'Which code is different from the other three?',
      stimulus: { kind: 'codes', items, labels: LABELS },
      options: LABELS,
      answer: at,
      render: 'mono',
      explain: `Code ${LABELS[at]} is ${odd}; the others are ${base}.`,
    };
  },

  row(r, p) {
    const rows = Math.min(p.grid, 6);
    const pool = 'ABCDEFGHJKLMNPRSTUVWXY';
    const target = r.pick(pool);
    const others = pool.replace(target, '');
    const at = r.int(0, rows - 1);
    const items = [];
    for (let i = 0; i < rows; i++) {
      const line = Array.from({ length: p.grid }, () => r.pick(others));
      if (i === at) line[r.int(0, p.grid - 1)] = target;
      items.push(...line);
    }
    return choice(r, {
      prompt: `Which row contains the letter “${target}”?`,
      stimulus: { kind: 'glyphs', cols: p.grid, items, rowLabels: true },
      answer: `Row ${at + 1}`,
      distractors: [...Array(rows).keys()].filter((i) => i !== at).map((i) => `Row ${i + 1}`),
      explain: `“${target}” is in row ${at + 1}.`,
    });
  },

  missing(r, p) {
    const n = p.missingTo;
    const gone = r.int(1, n);
    const items = r.shuffle([...Array(n).keys()].map((i) => i + 1).filter((v) => v !== gone));
    const cols = Math.ceil(Math.sqrt(n - 1));
    return choice(r, {
      prompt: `Every number from 1 to ${n} appears once — except one. Which is missing?`,
      stimulus: { kind: 'glyphs', cols, items: items.map(String) },
      answer: String(gone),
      distractors: r.sample(items, 5).map(String),
      explain: `${gone} is missing.`,
      render: 'mono',
    });
  },
};

export function attention(r, level) {
  const p = PARAMS[level];
  return T[r.pick(p.kinds)](r, p, level);
}
