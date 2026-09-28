import { bi, choice, fmt, nearNumbers } from './util.js';

/**
 * Numerical reasoning. Each level has its own template set; difficulty rises
 * through operand size, the number of steps, and how far the maths is hidden
 * inside the wording.
 *
 * Prompts and working are written in both languages with `bi()`. The numbers,
 * the options and the answer are the same in either.
 */

const num = (r, prompt, answer, explain, spread = 0.2) =>
  choice(r, {
    prompt,
    answer: fmt(answer),
    distractors: nearNumbers(r, answer, spread, Number.isInteger(answer)).map(fmt),
    explain,
    render: 'mono',
  });

/** Working that is nothing but arithmetic: identical in both, bar the full stop. */
const sum = (s) => bi(`${s}.`, s);

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const frac = (n, d) => {
  const g = gcd(n, d);
  return d / g === 1 ? `${n / g}` : `${n / g}/${d / g}`;
};

const L1 = [
  (r) => {
    const a = r.int(12, 59), b = r.int(8, 39);
    return num(r, bi(`What is ${a} + ${b}?`, `${a} + ${b} はいくつですか？`), a + b, sum(`${a} + ${b} = ${a + b}`));
  },
  (r) => {
    const a = r.int(30, 90), b = r.int(6, a - 5);
    return num(r, bi(`What is ${a} − ${b}?`, `${a} − ${b} はいくつですか？`), a - b, sum(`${a} − ${b} = ${a - b}`));
  },
  (r) => {
    const a = r.int(3, 9), b = r.int(3, 9);
    return num(r, bi(`What is ${a} × ${b}?`, `${a} × ${b} はいくつですか？`), a * b, sum(`${a} × ${b} = ${a * b}`));
  },
  (r) => {
    const n = r.int(6, 50) * 2;
    return num(r, bi(`What is half of ${n}?`, `${n} の半分はいくつですか？`), n / 2, sum(`${n} ÷ 2 = ${n / 2}`));
  },
  (r) => {
    const a = r.int(4, 15), b = r.int(3, 12);
    return num(
      r,
      bi(
        `You have ${a} pencils and buy ${b} more. How many do you have now?`,
        `鉛筆を${a}本持っていて、さらに${b}本買いました。いま何本ありますか？`,
      ),
      a + b,
      sum(`${a} + ${b} = ${a + b}`),
    );
  },
  (r) => {
    const n = r.int(3, 9), each = r.int(2, 6);
    return num(
      r,
      bi(
        `${n} boxes each hold ${each} eggs. How many eggs in total?`,
        `卵が${each}個ずつ入った箱が${n}箱あります。卵は全部で何個ですか？`,
      ),
      n * each,
      sum(`${n} × ${each} = ${n * each}`),
    );
  },
];

const L2 = [
  (r) => {
    const a = r.int(12, 39), b = r.int(3, 9);
    return num(r, bi(`What is ${a} × ${b}?`, `${a} × ${b} はいくつですか？`), a * b, sum(`${a} × ${b} = ${a * b}`));
  },
  (r) => {
    const b = r.int(3, 12), q = r.int(6, 25);
    return num(r, bi(`What is ${b * q} ÷ ${b}?`, `${b * q} ÷ ${b} はいくつですか？`), q, sum(`${b * q} ÷ ${b} = ${q}`));
  },
  (r) => {
    const p = r.pick([10, 20, 25, 50, 75]);
    const n = r.int(2, 20) * 20;
    return num(
      r,
      bi(`What is ${p}% of ${n}?`, `${n} の ${p}% はいくつですか？`),
      (p * n) / 100,
      bi(
        `${p}% of ${n} = ${n} × ${p / 100} = ${(p * n) / 100}.`,
        `${n} の ${p}% = ${n} × ${p / 100} = ${(p * n) / 100}`,
      ),
    );
  },
  (r) => {
    const [a, b] = r.pick([[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5]]);
    const n = b * r.int(3, 15);
    return num(
      r,
      bi(`What is ${a}/${b} of ${n}?`, `${n} の ${a}/${b} はいくつですか？`),
      (n / b) * a,
      sum(`${n} ÷ ${b} × ${a} = ${(n / b) * a}`),
    );
  },
  (r) => {
    const a = r.int(30, 80), b = r.int(10, a - 10), c = r.int(10, 40);
    return num(
      r,
      bi(`What is ${a} − ${b} + ${c}?`, `${a} − ${b} + ${c} はいくつですか？`),
      a - b + c,
      bi(`Left to right: ${a - b} + ${c} = ${a - b + c}.`, `左から順に：${a - b} + ${c} = ${a - b + c}`),
    );
  },
  (r) => {
    const price = r.int(2, 9), n = r.int(3, 8), paid = Math.ceil((price * n) / 10) * 10 + 10;
    return num(
      r,
      bi(
        `You buy ${n} items at ${price} each and pay with ${paid}. How much change?`,
        `1個${price}の品物を${n}個買い、${paid}で支払いました。おつりはいくらですか？`,
      ),
      paid - price * n,
      sum(`${paid} − ${n} × ${price} = ${paid - price * n}`),
    );
  },
];

const L3 = [
  (r) => {
    const p = r.pick([5, 15, 35, 45, 60, 85]);
    const n = r.int(2, 30) * 20;
    return num(
      r,
      bi(`What is ${p}% of ${n}?`, `${n} の ${p}% はいくつですか？`),
      (p * n) / 100,
      sum(`${n} × ${p}/100 = ${(p * n) / 100}`),
    );
  },
  (r) => {
    const a = r.int(1, 5), b = r.int(2, 7), unit = r.int(3, 12);
    const total = (a + b) * unit;
    const big = Math.max(a, b);
    return num(
      r,
      bi(
        `${total} is shared in the ratio ${a}:${b}. How large is the bigger share?`,
        `${total} を ${a}:${b} の比に分けます。大きいほうはいくつですか？`,
      ),
      big * unit,
      bi(
        `${total} ÷ ${a + b} = ${unit} per part; ${big} parts = ${big * unit}.`,
        `${total} ÷ ${a + b} = ${unit}（1つ分）。${big}つ分で ${big * unit}`,
      ),
    );
  },
  (r) => {
    const avg = r.int(30, 70);
    const xs = [r.int(-9, 9), r.int(-9, 9), r.int(-9, 9)].map((d) => avg + d);
    const last = avg * 4 - xs.reduce((s, x) => s + x, 0);
    const all = [...xs, last];
    return num(
      r,
      bi(`What is the average of ${all.join(', ')}?`, `${all.join('、')} の平均はいくつですか？`),
      avg,
      bi(`Sum ${avg * 4} ÷ 4 = ${avg}.`, `合計 ${avg * 4} ÷ 4 = ${avg}`),
    );
  },
  (r) => {
    const a = r.int(8, 30), b = r.int(2, 9), c = r.int(2, 9), d = r.int(1, a - 3);
    const v = a + b * c - d;
    return num(
      r,
      bi(`What is ${a} + ${b} × ${c} − ${d}?`, `${a} + ${b} × ${c} − ${d} はいくつですか？`),
      v,
      bi(
        `Multiply first: ${b} × ${c} = ${b * c}; ${a} + ${b * c} − ${d} = ${v}.`,
        `かけ算が先：${b} × ${c} = ${b * c}、${a} + ${b * c} − ${d} = ${v}`,
      ),
    );
  },
  (r) => {
    let speed, minutes;
    do {
      speed = r.pick([30, 40, 45, 60, 80, 90]);
      minutes = r.pick([20, 30, 40, 45, 80, 90]);
    } while ((speed * minutes) % 60 !== 0);
    const dist = (speed * minutes) / 60;
    return num(
      r,
      bi(
        `A train travels ${fmt(dist)} km at ${speed} km/h. How many minutes does it take?`,
        `列車が時速${speed}kmで${fmt(dist)}km進みます。何分かかりますか？`,
      ),
      minutes,
      bi(
        `${fmt(dist)} ÷ ${speed} = ${minutes / 60} h = ${minutes} min.`,
        `${fmt(dist)} ÷ ${speed} = ${minutes / 60}時間 = ${minutes}分`,
      ),
    );
  },
  (r) => {
    const w = r.int(4, 12), l = w + r.int(2, 10);
    return num(
      r,
      bi(
        `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter in cm?`,
        `縦${l}cm、横${w}cmの長方形があります。周りの長さは何cmですか？`,
      ),
      2 * (l + w),
      sum(`2 × (${l} + ${w}) = ${2 * (l + w)}`),
    );
  },
];

const L4 = [
  (r) => {
    const [x, y] = r.pick([[20, 25], [25, 20], [50, 20], [10, 10], [20, 50], [25, 40]]);
    const p = r.int(2, 12) * 100;
    const v = (p * (100 + x) * (100 - y)) / 10000;
    return num(
      r,
      bi(
        `A price of ${p} rises by ${x}%, then falls by ${y}%. What is the final price?`,
        `${p}の価格が${x}%上がり、そのあと${y}%下がりました。最終的な価格はいくらですか？`,
      ),
      v,
      sum(`${p} × ${1 + x / 100} × ${1 - y / 100} = ${fmt(v)}`),
      0.12,
    );
  },
  (r) => {
    const [a, b, t] = r.pick([[3, 6, 2], [4, 12, 3], [6, 12, 4], [10, 15, 6], [12, 24, 8], [20, 30, 12], [6, 3, 2]]);
    return num(
      r,
      bi(
        `One pump fills a tank in ${a} hours; another in ${b} hours. Working together, how many hours?`,
        `水そうを満たすのに、ポンプAでは${a}時間、ポンプBでは${b}時間かかります。2台を同時に使うと何時間かかりますか？`,
      ),
      t,
      bi(`Rates add: 1/${a} + 1/${b} = 1/${t}.`, `1時間あたりの量を足す：1/${a} + 1/${b} = 1/${t}`),
    );
  },
  (r) => {
    const x = r.int(8, 40), y = r.int(2, x - 3);
    return num(
      r,
      bi(
        `Two numbers add to ${x + y} and differ by ${x - y}. What is the larger number?`,
        `2つの数の和は${x + y}、差は${x - y}です。大きいほうの数はいくつですか？`,
      ),
      x,
      sum(`(${x + y} + ${x - y}) ÷ 2 = ${x}`),
    );
  },
  (r) => {
    const [a, b] = r.pick([[2, 3], [3, 4], [2, 5], [4, 5], [3, 5], [5, 6]]);
    const [c, d] = r.pick([[1, 6], [1, 4], [1, 10], [1, 12], [1, 3]]);
    const n = a * d + c * b, den = b * d;
    const ans = frac(n, den);
    const wrong = [frac(a + c, b + d), frac(n + 1, den), frac(a * c, b * d), frac(n, den + b), frac(n - 1, den)];
    return choice(r, {
      prompt: bi(`What is ${a}/${b} + ${c}/${d}?`, `${a}/${b} + ${c}/${d} はいくつですか？`),
      answer: ans,
      distractors: wrong,
      explain: bi(
        `Common denominator ${den}: ${a * d}/${den} + ${c * b}/${den} = ${ans}.`,
        `分母を${den}にそろえる：${a * d}/${den} + ${c * b}/${den} = ${ans}`,
      ),
      render: 'mono',
    });
  },
  (r) => {
    const from = r.int(4, 20) * 10;
    const pct = r.pick([-40, -25, -20, -10, 15, 20, 30, 50, 60]);
    const to = (from * (100 + pct)) / 100;
    return choice(r, {
      prompt: bi(
        `A value changes from ${from} to ${fmt(to)}. What is the percentage change?`,
        `ある値が${from}から${fmt(to)}に変わりました。変化率は何%ですか？`,
      ),
      answer: `${pct > 0 ? '+' : ''}${pct}%`,
      distractors: [pct + 5, pct - 5, -pct, pct * 2, Math.round(((to - from) / to) * 100)].map(
        (v) => `${v > 0 ? '+' : ''}${v}%`,
      ),
      explain: sum(`(${fmt(to)} − ${from}) ÷ ${from} = ${pct}%`),
      render: 'mono',
    });
  },
];

const L5 = [
  (r) => {
    const pct = r.pick([10, 20, 25, 40]);
    const orig = r.int(2, 20) * 20;
    const now = (orig * (100 - pct)) / 100;
    return num(
      r,
      bi(
        `After a ${pct}% discount an item costs ${fmt(now)}. What was the original price?`,
        `${pct}%引きで${fmt(now)}になった商品があります。元の価格はいくらでしたか？`,
      ),
      orig,
      sum(`${fmt(now)} ÷ ${1 - pct / 100} = ${orig}`),
      0.15,
    );
  },
  (r) => {
    const [n1, a1, n2, a2] = r.pick([[10, 70, 30, 90], [20, 60, 30, 80], [15, 80, 5, 60], [12, 50, 18, 75], [40, 65, 10, 90]]);
    const v = (n1 * a1 + n2 * a2) / (n1 + n2);
    return num(
      r,
      bi(
        `${n1} students average ${a1}; ${n2} students average ${a2}. What is the overall average?`,
        `${n1}人の平均点は${a1}点、別の${n2}人の平均点は${a2}点です。全員の平均点は何点ですか？`,
      ),
      v,
      sum(`(${n1}×${a1} + ${n2}×${a2}) ÷ ${n1 + n2} = ${fmt(v)}`),
      0.1,
    );
  },
  (r) => {
    const rate = r.pick([5, 10, 20]);
    const p = rate === 5 ? r.int(1, 5) * 400 : r.int(1, 20) * 100; // keeps the result whole
    const v = Math.round(p * (1 + rate / 100) ** 2);
    const simple = fmt(p + (p * rate * 2) / 100);
    return choice(r, {
      prompt: bi(
        `${fmt(p)} is invested at ${rate}% compound interest a year. What is it worth after 2 years?`,
        `${fmt(p)}を年利${rate}%の複利で運用します。2年後にはいくらになりますか？`,
      ),
      answer: fmt(v),
      distractors: [p + (p * rate * 2) / 100, v + p / 100, v - p / 50, p * (1 + rate / 100)].map((x) => fmt(Math.round(x))),
      explain: bi(
        `${fmt(p)} × ${1 + rate / 100}² = ${fmt(v)} (simple interest would give ${simple}).`,
        `${fmt(p)} × ${1 + rate / 100}² = ${fmt(v)}（単利なら${simple}）`,
      ),
      render: 'mono',
    });
  },
  (r) => {
    const n = r.int(5, 9), k = r.int(2, 3);
    const c = k === 2 ? (n * (n - 1)) / 2 : (n * (n - 1) * (n - 2)) / 6;
    return num(
      r,
      bi(
        `How many different teams of ${k} can be picked from ${n} people?`,
        `${n}人の中から${k}人のチームを選ぶ方法は何通りありますか？`,
      ),
      c,
      bi(`C(${n},${k}) = ${c}. Order does not matter.`, `C(${n},${k}) = ${c}。選ぶ順番は関係ありません。`),
      0.3,
    );
  },
  (r) => {
    const [a, x, b, y] = r.pick([[2, 10, 2, 30], [3, 20, 1, 40], [4, 5, 1, 30], [1, 10, 4, 35], [3, 12, 3, 28]]);
    const v = (a * x + b * y) / (a + b);
    return num(
      r,
      bi(
        `${a} L of a ${x}% solution is mixed with ${b} L of a ${y}% solution. What is the new concentration in %?`,
        `濃度${x}%の溶液${a}Lと、濃度${y}%の溶液${b}Lを混ぜます。混ぜたあとの濃度は何%ですか？`,
      ),
      v,
      sum(`(${a}×${x} + ${b}×${y}) ÷ ${a + b} = ${fmt(v)}%`),
      0.15,
    );
  },
  (r) => {
    const a = r.int(2, 9), b = r.int(a + 4, 18), c = r.int(1, (b - a) ** 2 - 1);
    const v = (a - b) ** 2 - c;
    return num(
      r,
      bi(`What is (${a} − ${b})² − ${c}?`, `(${a} − ${b})² − ${c} はいくつですか？`),
      v,
      bi(
        `(${a - b})² = ${(a - b) ** 2}; minus ${c} = ${v}.`,
        `(${a - b})² = ${(a - b) ** 2}、そこから${c}を引いて ${v}`,
      ),
    );
  },
];

const LEVELS = [L1, L2, L3, L4, L5];

export function numerical(r, level) {
  return r.pick(LEVELS[level - 1])(r);
}
