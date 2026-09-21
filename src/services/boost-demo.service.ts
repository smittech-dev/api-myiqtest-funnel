/**
 * The leaderboard's field of competitors — the one part of the members' area
 * that is deliberately **not** backed by real records.
 *
 * A leaderboard needs a field to be a leaderboard. Over real members alone it is
 * a table of one until the platform has a population, which reads as broken
 * rather than as new. The thirty below are generated from a fixed seed, so the
 * standings are stable between reloads, restarts and instances — the same
 * "Kenta" sits in the same place for everyone, and a member climbing it is
 * climbing something that does not move under them.
 *
 * The member's own row is real: their points and streak come from
 * `boost_profiles`, and their points now include the brain games, so their
 * position reflects their own training even though the field around them does
 * not.
 */

/* ── the deterministic generator ──────────────────────────────────────────── */

/** FNV-1a, the same hash the question generators use. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A seeded LCG, matching the prototype's exactly.
 *
 * Deterministic on purpose: the standings must not shuffle every time the page
 * is opened, and must be identical across server restarts and instances. A
 * random leaderboard would be obvious within two reloads.
 */
function rngFrom(seed: string): () => number {
  let s = hash(String(seed));
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const NAMES = [
  'Kenta', 'Minami', 'Satoshi', 'Ayaka', 'Takeshi', 'Rin', 'Hiro', 'Natsumi',
  'Daiki', 'Yui', 'Kaori', 'Sho', 'Manabu', 'Emi', 'Takumi', 'Sakura',
  'Koji', 'Akane', 'Ryo', 'Miho', 'Jun', 'Chie', 'Masashi', 'Nozomi',
  'Kazuki', 'Yuka', 'Tetsuya', 'Asuka', 'Shinji', 'Mai'
];

export type LeaderboardPeriod = 'today' | 'week' | 'all';
export type LeaderboardScope = 'total' | 'quiz' | 'game';

export interface LeaderboardRow {
  id: string;
  rank: number;
  name: string;
  initial: string;
  quiz: number;
  game: number;
  total: number;
  streak: number;
  me: boolean;
}

export interface MeOnBoard {
  id: string;
  displayName: string;
  /** Real, from the points ledger — quiz and games kept apart. */
  quizPoints: number;
  gamePoints: number;
  streak: number;
}

/**
 * Where the member sits on the board, from what they have actually earned.
 *
 * The field is demo data, so their rank is ours to decide — and putting a
 * paying member at 31st out of 31 is the one outcome that is both useless and
 * discouraging. They are placed inside the top twenty from their very first
 * quiz, and climb from there.
 *
 * The curve is logarithmic: the first few hundred points move them several
 * places, the last few move them one. That is the honest shape for a board they
 * cannot actually win, and it keeps the early days — when a habit is still
 * forming and most people quit — feeling like progress.
 *
 * Rank 3 is the ceiling. Handing someone first place would end the climb and
 * make the whole board obviously a prop.
 */
const BEST_RANK = 3;
const WORST_RANK = 20;

export function targetRankFor(points: number): number {
  const earned = Math.max(0, points);
  const rank = WORST_RANK - 6.5 * Math.log10(1 + earned / 120);

  return Math.min(WORST_RANK, Math.max(BEST_RANK, Math.round(rank)));
}

/**
 * The standings, with the member placed among them.
 *
 * `scale` stretches the field to suit the period, so a daily board shows daily
 * sized numbers. The member's own total is scaled the same way, which keeps
 * their position comparable across the three tabs rather than having them leap
 * to the top on "today" purely because the competitors shrank.
 */
export function leaderboardRows(
  period: LeaderboardPeriod,
  scope: LeaderboardScope,
  me: MeOnBoard
): { rows: LeaderboardRow[]; sortKey: LeaderboardScope } {
  const sortKey: LeaderboardScope = scope === 'quiz' ? 'quiz' : scope === 'game' ? 'game' : 'total';

  // The member's own figures are real — only the field around them is not.
  const periodScale = period === 'today' ? 0.14 : period === 'week' ? 1 : 3.6;
  const myQuiz = Math.round((me.quizPoints || 0) * periodScale);
  const myGame = Math.round((me.gamePoints || 0) * periodScale);
  const myTotal = myQuiz + myGame;
  const displayName = me.displayName || 'Member';

  /**
   * The roster's pecking order, fixed for everyone.
   *
   * Seeded only on the period and scope — deliberately not on the member — so
   * the same names sit in the same order on every member's board. Only the
   * numbers shift to bracket whoever is looking at it.
   */
  const order = rngFrom(`lb-order:${period}:${scope}`);
  const roster = [...NAMES]
    .map((name, i) => ({ name, i, strength: order() }))
    .sort((a, b) => b.strength - a.strength);

  const rank = targetRankFor(me.quizPoints + me.gamePoints);
  const above = rank - 1;

  /**
   * How far apart consecutive competitors sit above the member.
   *
   * Proportional to their own total so the gaps feel the same whatever scale
   * they are playing at, with a floor so a member on nothing still sees a board
   * with real numbers above them to climb towards.
   */
  const spread = Math.max(myTotal * 0.07, 40 * periodScale + 12);

  const jitter = rngFrom(`lb-jitter:${period}:${scope}`);

  /**
   * Each competitor's total, built as a ladder out from the member.
   *
   * Cumulative rather than computed per position, because a per-position
   * formula plus random variation can put a competitor above the one that
   * should outrank them — and then the roster reorders itself between two
   * members' boards. Adding a strictly positive step going up, and multiplying
   * by a factor strictly below one going down, makes the order impossible to
   * break while leaving the gaps irregular.
   */
  const totals = new Array<number>(roster.length);

  let running = myTotal;
  for (let i = above - 1, step = 1; i >= 0; i -= 1, step += 1) {
    // The gap widens with distance, so the top of the board is clearly ahead
    // rather than a uniform staircase.
    running += spread * (0.55 + jitter() * 0.9) * Math.pow(step, 0.45);
    totals[i] = running;
  }

  running = myTotal;
  for (let i = above; i < roster.length; i += 1) {
    running *= 0.78 + jitter() * 0.14;
    totals[i] = running;
  }

  const rows: LeaderboardRow[] = roster.map((entry, index) => {
    // A plausible split rather than a flat half: some people grind the quiz,
    // others play games.
    const total = Math.max(0, Math.round(totals[index]));
    const quiz = Math.round(total * (0.35 + jitter() * 0.3));
    const game = total - quiz;

    return {
      id: `n${entry.i}`,
      rank: 0,
      name: entry.name,
      initial: entry.name.charAt(0).toUpperCase(),
      quiz,
      game,
      total,
      streak: 2 + Math.floor(jitter() * 30),
      me: false
    };
  });

  rows.push({
    id: me.id,
    rank: 0,
    name: displayName,
    initial: displayName.trim().charAt(0).toUpperCase() || '?',
    quiz: myQuiz,
    game: myGame,
    total: myTotal,
    streak: me.streak || 0,
    me: true
  });

  // Sorting by the requested column can move the member off their target rank —
  // someone who has only played games sits lower on the quiz board, which is
  // correct and worth showing. The target governs the overall standing.
  //
  // Ties resolve in the member's favour. That is not flattery: a member on zero
  // points has every competitor below them on zero too, and an arbitrary
  // tie-break put them last of thirty-one — the exact outcome the target rank
  // exists to prevent, hitting exactly the member it matters most for.
  rows.sort((a, b) => {
    const byScore = b[sortKey] - a[sortKey];
    if (byScore !== 0) return byScore;
    if (a.me) return -1;
    if (b.me) return 1;
    return 0;
  });
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return { rows, sortKey };
}
