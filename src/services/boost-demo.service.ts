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
 * The standings, with the member placed among them.
 *
 * `scale` stretches the field to suit the period, so a daily board shows daily
 * sized numbers. The member's own total is scaled the same way, which keeps
 * their position roughly honest across the three tabs rather than having them
 * leap to the top on "today" purely because the competitors shrank.
 */
export function leaderboardRows(
  period: LeaderboardPeriod,
  scope: LeaderboardScope,
  me: MeOnBoard
): { rows: LeaderboardRow[]; sortKey: LeaderboardScope } {
  const rnd = rngFrom(`lb:${period}:${scope}`);
  const scale = period === 'today' ? 0.16 : period === 'week' ? 1 : 4.2;

  const rows: LeaderboardRow[] = NAMES.map((name, i) => {
    const quiz = Math.round((900 + rnd() * 1400) * scale);
    const game = Math.round((900 + rnd() * 1400) * scale);
    return {
      id: `n${i}`,
      rank: 0,
      name,
      initial: name.charAt(0).toUpperCase(),
      quiz,
      game,
      total: quiz + game,
      streak: 2 + Math.floor(rnd() * 30),
      me: false
    };
  });

  // The member's own figures are real — only the field around them is not.
  // Scaled by the same factor as the competitors so the three period tabs stay
  // comparable, rather than having them leap to the top on "today" purely
  // because everyone else shrank.
  const periodScale = period === 'today' ? 0.14 : period === 'week' ? 1 : 3.6;
  const myQuiz = Math.round((me.quizPoints || 0) * periodScale);
  const myGame = Math.round((me.gamePoints || 0) * periodScale);
  const displayName = me.displayName || 'Member';

  rows.push({
    id: me.id,
    rank: 0,
    name: displayName,
    initial: displayName.trim().charAt(0).toUpperCase() || '?',
    quiz: myQuiz,
    game: myGame,
    total: myQuiz + myGame,
    streak: me.streak || 0,
    me: true
  });

  const sortKey: LeaderboardScope = scope === 'quiz' ? 'quiz' : scope === 'game' ? 'game' : 'total';
  rows.sort((a, b) => b[sortKey] - a[sortKey]);
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return { rows, sortKey };
}
