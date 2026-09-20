/** Deterministic helpers shared by the Boost My IQ question generators. */

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32) with a few conveniences hung off it. */
export function rng(seed) {
  let s = hash(String(seed)) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  next.sample = (arr, n) => next.shuffle(arr).slice(0, n);
  return next;
}

export const fmt = (n) =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100);

/**
 * Build a four-option multiple choice from a correct value and candidate
 * distractors. Duplicates are dropped; `fill` supplies more if needed.
 */
export function choice(r, { prompt, answer, distractors = [], fill, stimulus, study, render, explain }) {
  const key = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
  const seen = new Set([key(answer)]);
  const wrong = [];
  for (const d of r.shuffle(distractors)) {
    if (wrong.length === 3) break;
    if (d == null || seen.has(key(d))) continue;
    seen.add(key(d));
    wrong.push(d);
  }
  let guard = 0;
  while (wrong.length < 3 && fill && guard++ < 60) {
    const d = fill();
    if (d == null || seen.has(key(d))) continue;
    seen.add(key(d));
    wrong.push(d);
  }
  const options = r.shuffle([answer, ...wrong]);
  return {
    type: 'choice',
    prompt,
    stimulus,
    study,
    render: render || 'text',
    options,
    answer: options.findIndex((o) => key(o) === key(answer)),
    explain,
  };
}

/** Near-miss numeric distractors that look plausible. */
export function nearNumbers(r, answer, spread = 0.2, integer = true) {
  const out = [];
  const base = Math.max(8, Math.abs(answer)); // small answers still get a spread
  for (let i = 0; i < 12; i++) {
    const delta = Math.max(1, Math.round(base * spread * r())) * (r() < 0.5 ? -1 : 1);
    let v = answer + delta;
    if (!integer) v = Math.round((answer + base * spread * (r() - 0.5) * 2) * 100) / 100;
    if (v !== answer && v >= 0) out.push(v);
  }
  out.push(answer + 1, answer - 1, answer + 10, answer * 2);
  return out.filter((v) => v >= 0 && v !== answer);
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
