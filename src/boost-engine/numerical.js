import { choice, fmt, nearNumbers } from './util.js';

/**
 * Numerical reasoning. Each level has its own template set; difficulty rises
 * through operand size, the number of steps, and how far the maths is hidden
 * inside the wording.
 */

const num = (r, prompt, answer, explain, spread = 0.2) =>
  choice(r, {
    prompt,
    answer: fmt(answer),
    distractors: nearNumbers(r, answer, spread, Number.isInteger(answer)).map(fmt),
    explain,
    render: 'mono',
  });

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const frac = (n, d) => {
  const g = gcd(n, d);
  return d / g === 1 ? `${n / g}` : `${n / g}/${d / g}`;
};

const L1 = [
  (r) => {
    const a = r.int(12, 59), b = r.int(8, 39);
    return num(r, `What is ${a} + ${b}?`, a + b, `${a} + ${b} = ${a + b}.`);
  },
  (r) => {
    const a = r.int(30, 90), b = r.int(6, a - 5);
    return num(r, `What is ${a} − ${b}?`, a - b, `${a} − ${b} = ${a - b}.`);
  },
  (r) => {
    const a = r.int(3, 9), b = r.int(3, 9);
    return num(r, `What is ${a} × ${b}?`, a * b, `${a} × ${b} = ${a * b}.`);
  },
  (r) => {
    const n = r.int(6, 50) * 2;
    return num(r, `What is half of ${n}?`, n / 2, `${n} ÷ 2 = ${n / 2}.`);
  },
  (r) => {
    const a = r.int(4, 15), b = r.int(3, 12);
    return num(r, `You have ${a} pencils and buy ${b} more. How many do you have now?`, a + b, `${a} + ${b} = ${a + b}.`);
  },
  (r) => {
    const n = r.int(3, 9), each = r.int(2, 6);
    return num(r, `${n} boxes each hold ${each} eggs. How many eggs in total?`, n * each, `${n} × ${each} = ${n * each}.`);
  },
];

const L2 = [
  (r) => {
    const a = r.int(12, 39), b = r.int(3, 9);
    return num(r, `What is ${a} × ${b}?`, a * b, `${a} × ${b} = ${a * b}.`);
  },
  (r) => {
    const b = r.int(3, 12), q = r.int(6, 25);
    return num(r, `What is ${b * q} ÷ ${b}?`, q, `${b * q} ÷ ${b} = ${q}.`);
  },
  (r) => {
    const p = r.pick([10, 20, 25, 50, 75]);
    const n = r.int(2, 20) * 20;
    return num(r, `What is ${p}% of ${n}?`, (p * n) / 100, `${p}% of ${n} = ${n} × ${p / 100} = ${(p * n) / 100}.`);
  },
  (r) => {
    const [a, b] = r.pick([[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5]]);
    const n = b * r.int(3, 15);
    return num(r, `What is ${a}/${b} of ${n}?`, (n / b) * a, `${n} ÷ ${b} × ${a} = ${(n / b) * a}.`);
  },
  (r) => {
    const a = r.int(30, 80), b = r.int(10, a - 10), c = r.int(10, 40);
    return num(r, `What is ${a} − ${b} + ${c}?`, a - b + c, `Left to right: ${a - b} + ${c} = ${a - b + c}.`);
  },
  (r) => {
    const price = r.int(2, 9), n = r.int(3, 8), paid = Math.ceil((price * n) / 10) * 10 + 10;
    return num(r, `You buy ${n} items at ${price} each and pay with ${paid}. How much change?`, paid - price * n, `${paid} − ${n} × ${price} = ${paid - price * n}.`);
  },
];

const L3 = [
  (r) => {
    const p = r.pick([5, 15, 35, 45, 60, 85]);
    const n = r.int(2, 30) * 20;
    return num(r, `What is ${p}% of ${n}?`, (p * n) / 100, `${n} × ${p}/100 = ${(p * n) / 100}.`);
  },
  (r) => {
    const a = r.int(1, 5), b = r.int(2, 7), unit = r.int(3, 12);
    const total = (a + b) * unit;
    return num(r, `${total} is shared in the ratio ${a}:${b}. How large is the bigger share?`, Math.max(a, b) * unit, `${total} ÷ ${a + b} = ${unit} per part; ${Math.max(a, b)} parts = ${Math.max(a, b) * unit}.`);
  },
  (r) => {
    const avg = r.int(30, 70);
    const xs = [r.int(-9, 9), r.int(-9, 9), r.int(-9, 9)].map((d) => avg + d);
    const last = avg * 4 - xs.reduce((s, x) => s + x, 0);
    const all = [...xs, last];
    return num(r, `What is the average of ${all.join(', ')}?`, avg, `Sum ${avg * 4} ÷ 4 = ${avg}.`);
  },
  (r) => {
    const a = r.int(8, 30), b = r.int(2, 9), c = r.int(2, 9), d = r.int(1, a - 3);
    const v = a + b * c - d;
    return num(r, `What is ${a} + ${b} × ${c} − ${d}?`, v, `Multiply first: ${b} × ${c} = ${b * c}; ${a} + ${b * c} − ${d} = ${v}.`);
  },
  (r) => {
    let speed, minutes;
    do {
      speed = r.pick([30, 40, 45, 60, 80, 90]);
      minutes = r.pick([20, 30, 40, 45, 80, 90]);
    } while ((speed * minutes) % 60 !== 0);
    const dist = (speed * minutes) / 60;
    return num(r, `A train travels ${fmt(dist)} km at ${speed} km/h. How many minutes does it take?`, minutes, `${fmt(dist)} ÷ ${speed} = ${minutes / 60} h = ${minutes} min.`);
  },
  (r) => {
    const w = r.int(4, 12), l = w + r.int(2, 10);
    return num(r, `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter in cm?`, 2 * (l + w), `2 × (${l} + ${w}) = ${2 * (l + w)}.`);
  },
];

const L4 = [
  (r) => {
    const [x, y] = r.pick([[20, 25], [25, 20], [50, 20], [10, 10], [20, 50], [25, 40]]);
    const p = r.int(2, 12) * 100;
    const v = (p * (100 + x) * (100 - y)) / 10000;
    return num(r, `A price of ${p} rises by ${x}%, then falls by ${y}%. What is the final price?`, v, `${p} × ${1 + x / 100} × ${1 - y / 100} = ${fmt(v)}.`, 0.12);
  },
  (r) => {
    const [a, b, t] = r.pick([[3, 6, 2], [4, 12, 3], [6, 12, 4], [10, 15, 6], [12, 24, 8], [20, 30, 12], [6, 3, 2]]);
    return num(r, `One pump fills a tank in ${a} hours; another in ${b} hours. Working together, how many hours?`, t, `Rates add: 1/${a} + 1/${b} = 1/${t}.`);
  },
  (r) => {
    const x = r.int(8, 40), y = r.int(2, x - 3);
    return num(r, `Two numbers add to ${x + y} and differ by ${x - y}. What is the larger number?`, x, `(${x + y} + ${x - y}) ÷ 2 = ${x}.`);
  },
  (r) => {
    const [a, b] = r.pick([[2, 3], [3, 4], [2, 5], [4, 5], [3, 5], [5, 6]]);
    const [c, d] = r.pick([[1, 6], [1, 4], [1, 10], [1, 12], [1, 3]]);
    const n = a * d + c * b, den = b * d;
    const ans = frac(n, den);
    const wrong = [frac(a + c, b + d), frac(n + 1, den), frac(a * c, b * d), frac(n, den + b), frac(n - 1, den)];
    return choice(r, {
      prompt: `What is ${a}/${b} + ${c}/${d}?`,
      answer: ans,
      distractors: wrong,
      explain: `Common denominator ${den}: ${a * d}/${den} + ${c * b}/${den} = ${ans}.`,
      render: 'mono',
    });
  },
  (r) => {
    const from = r.int(4, 20) * 10;
    const pct = r.pick([-40, -25, -20, -10, 15, 20, 30, 50, 60]);
    const to = (from * (100 + pct)) / 100;
    return choice(r, {
      prompt: `A value changes from ${from} to ${fmt(to)}. What is the percentage change?`,
      answer: `${pct > 0 ? '+' : ''}${pct}%`,
      distractors: [pct + 5, pct - 5, -pct, pct * 2, Math.round(((to - from) / to) * 100)].map(
        (v) => `${v > 0 ? '+' : ''}${v}%`,
      ),
      explain: `(${fmt(to)} − ${from}) ÷ ${from} = ${pct}%.`,
      render: 'mono',
    });
  },
];

const L5 = [
  (r) => {
    const pct = r.pick([10, 20, 25, 40]);
    const orig = r.int(2, 20) * 20;
    const now = (orig * (100 - pct)) / 100;
    return num(r, `After a ${pct}% discount an item costs ${fmt(now)}. What was the original price?`, orig, `${fmt(now)} ÷ ${1 - pct / 100} = ${orig}.`, 0.15);
  },
  (r) => {
    const [n1, a1, n2, a2] = r.pick([[10, 70, 30, 90], [20, 60, 30, 80], [15, 80, 5, 60], [12, 50, 18, 75], [40, 65, 10, 90]]);
    const v = (n1 * a1 + n2 * a2) / (n1 + n2);
    return num(r, `${n1} students average ${a1}; ${n2} students average ${a2}. What is the overall average?`, v, `(${n1}×${a1} + ${n2}×${a2}) ÷ ${n1 + n2} = ${fmt(v)}.`, 0.1);
  },
  (r) => {
    const rate = r.pick([5, 10, 20]);
    const p = rate === 5 ? r.int(1, 5) * 400 : r.int(1, 20) * 100; // keeps the result whole
    const v = Math.round(p * (1 + rate / 100) ** 2);
    return choice(r, {
      prompt: `${fmt(p)} is invested at ${rate}% compound interest a year. What is it worth after 2 years?`,
      answer: fmt(v),
      distractors: [p + (p * rate * 2) / 100, v + p / 100, v - p / 50, p * (1 + rate / 100)].map((x) => fmt(Math.round(x))),
      explain: `${fmt(p)} × ${1 + rate / 100}² = ${fmt(v)} (simple interest would give ${fmt(p + (p * rate * 2) / 100)}).`,
      render: 'mono',
    });
  },
  (r) => {
    const n = r.int(5, 9), k = r.int(2, 3);
    const c = k === 2 ? (n * (n - 1)) / 2 : (n * (n - 1) * (n - 2)) / 6;
    return num(r, `How many different teams of ${k} can be picked from ${n} people?`, c, `C(${n},${k}) = ${c}. Order does not matter.`, 0.3);
  },
  (r) => {
    const [a, x, b, y] = r.pick([[2, 10, 2, 30], [3, 20, 1, 40], [4, 5, 1, 30], [1, 10, 4, 35], [3, 12, 3, 28]]);
    const v = (a * x + b * y) / (a + b);
    return num(r, `${a} L of a ${x}% solution is mixed with ${b} L of a ${y}% solution. What is the new concentration in %?`, v, `(${a}×${x} + ${b}×${y}) ÷ ${a + b} = ${fmt(v)}%.`, 0.15);
  },
  (r) => {
    const a = r.int(2, 9), b = r.int(a + 4, 18), c = r.int(1, (b - a) ** 2 - 1);
    const v = (a - b) ** 2 - c;
    return num(r, `What is (${a} − ${b})² − ${c}?`, v, `(${a - b})² = ${(a - b) ** 2}; minus ${c} = ${v}.`);
  },
];

const LEVELS = [L1, L2, L3, L4, L5];

export function numerical(r, level) {
  return r.pick(LEVELS[level - 1])(r);
}
