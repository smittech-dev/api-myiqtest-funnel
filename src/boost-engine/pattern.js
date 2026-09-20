import { choice, nearNumbers, LETTERS } from './util.js';

/**
 * Pattern recognition: number and letter sequences, dot matrices, number grids
 * and shape sequences. Higher levels hide the rule behind interleaving, second
 * differences, alternating operations and two-attribute changes.
 */

const SHAPES = ['circle', 'square', 'triangle', 'diamond'];

const seqQ = (r, items, answer, explain, distractors, render = 'mono') =>
  choice(r, {
    prompt: 'What comes next in the sequence?',
    stimulus: { kind: 'seq', items: [...items, '?'] },
    answer: String(answer),
    distractors: distractors.map(String),
    explain,
    render,
  });

const numSeq = (r, items, answer, explain, spread = 0.25) =>
  seqQ(r, items, answer, explain, nearNumbers(r, answer, spread));

const letterNear = (i) =>
  [i - 1, i + 1, i + 2, i - 2, i + 3, i - 3, i - 4].filter((x) => x >= 0 && x < 26).map((x) => LETTERS[x]);

const shapeQ = (r, items, answer, explain, distractors) =>
  choice(r, {
    prompt: 'Which shape comes next?',
    stimulus: { kind: 'shapes', items: [...items, null] },
    answer,
    distractors,
    explain,
    render: 'shape',
  });

const rotations = (shape, fill) => [0, 45, 90, 135, 180, 225, 270, 315].map((rot) => ({ s: shape, rot, fill }));

const dotMatrix = (r, cells, answer, explain) =>
  choice(r, {
    prompt: 'Which option completes the grid?',
    stimulus: { kind: 'dots', cells: [...cells, null] },
    answer,
    distractors: [answer - 1, answer + 1, answer + 2, answer - 2, answer + 3, answer - 3].filter((v) => v >= 1 && v <= 9),
    explain,
    render: 'dots',
  });

/* ── level 1 ─────────────────────────────────────────────────────────────── */
const L1 = [
  (r) => {
    const a = r.int(1, 10), d = r.int(2, 5);
    const xs = [0, 1, 2, 3, 4].map((i) => a + d * i);
    return numSeq(r, xs, a + d * 5, `Add ${d} each time.`);
  },
  (r) => {
    const [a, b, c] = r.sample([1, 2, 3, 4, 5, 6], 3);
    return dotMatrix(r, [a, a, a, b, b, b, c, c], c, 'Every cell in a row has the same number of dots.');
  },
  (r) => {
    const [a, b] = r.sample(SHAPES, 2);
    const items = [a, b, a, b, a].map((s) => ({ s, rot: 0, fill: true }));
    return shapeQ(r, items, { s: b, rot: 0, fill: true }, 'The two shapes alternate.', [
      { s: a, rot: 0, fill: true },
      { s: b, rot: 0, fill: false },
      ...SHAPES.filter((x) => x !== a && x !== b).map((s) => ({ s, rot: 0, fill: true })),
    ]);
  },
  (r) => {
    const i = r.int(0, 18);
    const xs = [0, 1, 2, 3].map((k) => LETTERS[i + k]);
    return seqQ(r, xs, LETTERS[i + 4], 'Letters in alphabetical order.', letterNear(i + 4));
  },
];

/* ── level 2 ─────────────────────────────────────────────────────────────── */
const L2 = [
  (r) => {
    const d = r.pick([-3, -4, -6, -7, 6, 7, 8, 9, 11, 12]);
    const a = d < 0 ? r.int(60, 99) : r.int(3, 20);
    const xs = [0, 1, 2, 3, 4].map((i) => a + d * i);
    return numSeq(r, xs, a + d * 5, `${d > 0 ? 'Add' : 'Subtract'} ${Math.abs(d)} each time.`);
  },
  (r) => {
    const m = r.pick([2, 3]), a = r.int(1, 4);
    const xs = [0, 1, 2, 3].map((i) => a * m ** i);
    const ans = a * m ** 4;
    return seqQ(r, xs, ans, `Multiply by ${m} each time.`, [ans + m, a * m ** 3 + a * m ** 2, ans - a, ans * 2]);
  },
  (r) => {
    const step = r.pick([2, 3]);
    const i = r.int(0, 25 - step * 4);
    const xs = [0, 1, 2, 3].map((k) => LETTERS[i + step * k]);
    const ans = i + step * 4;
    return seqQ(r, xs, LETTERS[ans], `Skip ${step - 1} letter${step > 2 ? 's' : ''} each time.`, letterNear(ans));
  },
  (r) => {
    const s = r.pick(['arrow', 'triangle']);
    const start = r.pick([0, 90, 180, 270]);
    const items = [0, 1, 2, 3].map((k) => ({ s, rot: (start + 90 * k) % 360, fill: true }));
    const ans = { s, rot: (start + 360) % 360, fill: true };
    return shapeQ(r, items, ans, 'The shape turns 90° clockwise each step.', rotations(s, true));
  },
  (r) => {
    const cells = [1, 2, 3, 2, 3, 4, 3, 4];
    return dotMatrix(r, cells, 5, 'Each row starts one higher and counts up by one.');
  },
];

/* ── level 3 ─────────────────────────────────────────────────────────────── */
const L3 = [
  (r) => {
    const a = r.int(1, 9), da = r.int(2, 4), b = r.int(20, 40), db = r.pick([-3, -2, 5, 6]);
    const xs = [a, b, a + da, b + db, a + 2 * da, b + 2 * db];
    const ans = a + 3 * da;
    return numSeq(r, xs, ans, `Two sequences alternate: ${a}, ${a + da}, ${a + 2 * da}… (+${da}) and ${b}, ${b + db}… (${db > 0 ? '+' : ''}${db}).`);
  },
  (r) => {
    const o = r.int(1, 5), c = r.pick([0, 1]);
    const xs = [0, 1, 2, 3, 4].map((k) => (o + k) ** 2 + c);
    const ans = (o + 5) ** 2 + c;
    return numSeq(r, xs, ans, `Square numbers${c ? ' plus one' : ''}: ${o + 5}² ${c ? '+ 1 ' : ''}= ${ans}.`, 0.1);
  },
  (r) => {
    const a = r.int(1, 5), b = r.int(2, 6);
    const xs = [a, b];
    while (xs.length < 6) xs.push(xs[xs.length - 1] + xs[xs.length - 2]);
    const ans = xs[4] + xs[5];
    return numSeq(r, xs, ans, 'Each number is the sum of the previous two.', 0.15);
  },
  (r) => {
    const i = r.int(0, 10);
    const pos = [0, 1, 3, 6, 10].map((g) => i + g);
    const ans = i + 15;
    return seqQ(r, pos.map((p) => LETTERS[p]), LETTERS[ans], 'The gap grows by one each time: +1, +2, +3, +4, +5.', letterNear(ans));
  },
  (r) => {
    const cycle = r.sample(SHAPES, 3);
    const items = [0, 1, 2, 3, 4].map((k) => ({ s: cycle[k % 3], rot: 0, fill: k % 2 === 0 }));
    const ans = { s: cycle[5 % 3], rot: 0, fill: false };
    return shapeQ(r, items, ans, 'Shapes cycle in threes while the fill alternates.', [
      { s: cycle[5 % 3], rot: 0, fill: true },
      { s: cycle[0], rot: 0, fill: false },
      { s: cycle[1], rot: 0, fill: false },
      { s: cycle[0], rot: 0, fill: true },
    ]);
  },
];

/* ── level 4 ─────────────────────────────────────────────────────────────── */
const L4 = [
  (r) => {
    const a = r.int(1, 10), b = r.int(1, 5), c = r.int(2, 4);
    const xs = [a];
    let d = b;
    for (let k = 0; k < 5; k++) {
      xs.push(xs[xs.length - 1] + d);
      d += c;
    }
    const ans = xs[5] + d;
    return numSeq(r, xs, ans, `The differences grow by ${c}: ${b}, ${b + c}, ${b + 2 * c}…`, 0.15);
  },
  (r) => {
    const a = r.int(1, 4), c = r.int(1, 3);
    const xs = [a];
    while (xs.length < 5) xs.push(xs[xs.length - 1] * 2 + c);
    const ans = xs[4] * 2 + c;
    return seqQ(r, xs, ans, `Double, then add ${c}.`, [ans - c, ans + c, xs[4] * 2, ans + 2 * c, ans - 2]);
  },
  (r) => {
    const li = r.int(0, 8), ls = r.pick([2, 3]), n0 = r.int(1, 4), ns = r.pick([2, 3]);
    const xs = [0, 1, 2, 3].map((k) => `${LETTERS[li + ls * k]}${n0 + ns * k}`);
    const ans = `${LETTERS[li + ls * 4]}${n0 + ns * 4}`;
    return seqQ(r, xs, ans, `Letters move ${ls}, numbers add ${ns}.`, [
      `${LETTERS[li + ls * 4 + 1]}${n0 + ns * 4}`,
      `${LETTERS[li + ls * 4]}${n0 + ns * 4 + 1}`,
      `${LETTERS[li + ls * 4 - 1]}${n0 + ns * 4 - 1}`,
      `${LETTERS[li + ls * 3 + 1]}${n0 + ns * 4}`,
    ]);
  },
  (r) => {
    const start = r.pick([0, 45, 90]);
    const items = [0, 1, 2, 3, 4].map((k) => ({ s: 'arrow', rot: (start + 45 * k) % 360, fill: k % 2 === 0 }));
    const ans = { s: 'arrow', rot: (start + 225) % 360, fill: false };
    return shapeQ(r, items, ans, 'Turns 45° each step while the fill alternates.', [
      { s: 'arrow', rot: (start + 225) % 360, fill: true },
      { s: 'arrow', rot: (start + 270) % 360, fill: false },
      { s: 'arrow', rot: (start + 180) % 360, fill: false },
      { s: 'arrow', rot: (start + 90) % 360, fill: false },
    ]);
  },
  (r) => {
    const rows = [0, 1, 2].map(() => [r.int(1, 4), r.int(1, 4)]);
    const cells = [...rows[0], rows[0][0] + rows[0][1], ...rows[1], rows[1][0] + rows[1][1], ...rows[2]];
    return dotMatrix(r, cells, rows[2][0] + rows[2][1], 'In each row, the third cell is the sum of the first two.');
  },
];

/* ── level 5 ─────────────────────────────────────────────────────────────── */
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79];

const L5 = [
  (r) => {
    const a = r.int(1, 5), add = r.int(2, 5);
    const xs = [a];
    for (let k = 0; k < 5; k++) xs.push(k % 2 === 0 ? xs[k] * 2 : xs[k] + add);
    // six terms end on a ×2 step, so the next step is +add
    const ans = xs[5] + add;
    return seqQ(r, xs, ans, `Alternately ×2 and +${add}.`, [xs[5] * 2, ans + add, ans - 1, xs[5] + add * 2]);
  },
  (r) => {
    const i = r.int(0, PRIMES.length - 7);
    const xs = PRIMES.slice(i, i + 5);
    const ans = PRIMES[i + 5];
    return seqQ(r, xs, ans, 'Consecutive prime numbers.', [ans + 1, ans + 2, ans - 1, ans + 4].filter((v) => v !== ans));
  },
  (r) => {
    if (r() < 0.5) {
      const o = r.int(1, 3);
      const xs = [0, 1, 2, 3].map((k) => (o + k) ** 3);
      return numSeq(r, xs, (o + 4) ** 3, `Cube numbers: ${o + 4}³ = ${(o + 4) ** 3}.`, 0.1);
    }
    const o = r.int(2, 6);
    const t = (n) => (n * (n + 1)) / 2;
    const xs = [0, 1, 2, 3, 4].map((k) => t(o + k));
    return numSeq(r, xs, t(o + 5), 'Triangular numbers: the gap grows by one each time.', 0.15);
  },
  (r) => {
    if (r() < 0.5) {
      const xs = [1, 4, 9, 16].map((p) => LETTERS[p - 1]);
      return seqQ(r, xs, 'Y', 'Positions 1, 4, 9, 16, 25 — square numbers. The 25th letter is Y.', ['X', 'Z', 'U', 'V']);
    }
    const xs = [2, 3, 5, 7, 11].map((p) => LETTERS[p - 1]);
    return seqQ(r, xs, 'M', 'Positions 2, 3, 5, 7, 11, 13 — prime numbers. The 13th letter is M.', ['L', 'N', 'O', 'P']);
  },
  (r) => {
    const rule = r.pick(['mul', 'mix']);
    const rows = [0, 1, 2].map(() => [r.int(2, 9), r.int(2, 6)]);
    const f = rule === 'mul' ? (a, b) => a * b : (a, b) => a * b - a;
    const cells = rows.flatMap(([a, b], i) => (i < 2 ? [a, b, f(a, b)] : [a, b]));
    const ans = f(...rows[2]);
    return choice(r, {
      prompt: 'Which number completes the grid?',
      stimulus: { kind: 'numgrid', cells: [...cells, null] },
      answer: String(ans),
      distractors: nearNumbers(r, ans, 0.2).map(String).concat(String(rows[2][0] * rows[2][1] + rows[2][0])),
      explain: rule === 'mul' ? 'Third = first × second.' : 'Third = first × second − first.',
      render: 'mono',
    });
  },
  (r) => {
    // only shapes whose rotation is visible, or the options would look identical
    const cycle = r.shuffle(['triangle', 'arrow']);
    const items = [0, 1, 2, 3, 4].map((k) => ({ s: cycle[k % 2], rot: (90 * k) % 360, fill: k % 3 !== 2 }));
    // k = 5: second shape, 450° ≡ 90°, and 5 % 3 === 2 so it is hollow
    const ans = { s: cycle[1], rot: 90, fill: false };
    return shapeQ(r, items, ans, 'Shapes alternate, turn 90° each step, and every third is hollow.', [
      { s: cycle[1], rot: 90, fill: true },
      { s: cycle[0], rot: 90, fill: false },
      { s: cycle[1], rot: 0, fill: false },
      { s: cycle[1], rot: 180, fill: false },
    ]);
  },
];

const LEVELS = [L1, L2, L3, L4, L5];

export function pattern(r, level) {
  return r.pick(LEVELS[level - 1])(r);
}
