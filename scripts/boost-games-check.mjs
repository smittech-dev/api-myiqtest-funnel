/**
 * Brain games, and the report that reads them.
 *
 *   npm run test:boost:games   (run `npm run test:boost` first — it seeds the
 *                               member and leaves the password this expects)
 *
 * The games are dynamic now: one row per finished run, and every figure the
 * screens show — best, plays, average, the report's table — is an aggregate
 * over those rows. So what is checked here is that the aggregate is right for
 * every kind of game, including the one where lower wins, and that the report
 * moves when a game is played.
 *
 * The leaderboard's field of competitors stays demo data by decision; the
 * member's own row on it does not, and that is checked too.
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this test writes to the database and NODE_ENV is production.');
  process.exit(1);
}

const BASE = (process.env.BOOST_TEST_BASE_URL || 'http://localhost:' + (process.env.PORT || 5000)) + '/boost-api/v1';
const EMAIL = 'boost.tester@example.com';
const PASSWORD = process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd';
const ORIGIN = (process.env.BOOST_APP_ORIGINS || 'http://localhost:5173').split(',')[0].trim();

let token = null;
let pass = 0, fail = 0;
const out = [];
const check = (n, c, d = '') => { c ? (pass++, out.push('  PASS  ' + n)) : (fail++, out.push('  FAIL  ' + n + (d ? ' :: ' + d : ''))); };

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await res.text();
  if (res.status === 429) { console.error('\nRate limited — restart the server and try again.\n'); process.exit(2); }
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

const db = new pg.Client({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE
});
await db.connect();
const CID = (await db.query('SELECT id FROM customers WHERE email=$1', [EMAIL])).rows[0].id;

// Start from no game history, so every aggregate below is one this run created.
await db.query("DELETE FROM member_points_ledger WHERE customer_id=$1 AND source='game'", [CID]);
await db.query('DELETE FROM game_runs WHERE customer_id=$1', [CID]);
await db.query("UPDATE customer_subscriptions SET status='active' WHERE customer_id=$1", [CID]);

let r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
if (r.status !== 200) {
  console.error('\nCould not sign in as the test member. Run `npm run test:boost` first.\n');
  process.exit(1);
}
token = r.body.token;

const pointsBefore = (await call('GET', '/me')).body.stats.points;

out.push('--- A member with no game history');

r = await call('GET', '/games');
check('GET /games -> 200', r.status === 200);
check('no runs means no progress, not an error', Object.keys(r.body.progress).length === 0, JSON.stringify(r.body.progress));

r = await call('GET', '/games/speed-math');
check('GET /games/:slug still returns the game', r.status === 200 && r.body.game?.slug === 'speed-math');
check('progress is null before the first play', r.body.progress === null);

r = await call('GET', '/games/not-a-game');
check('unknown slug -> 404', r.status === 404 && r.body.code === 'not_found');

out.push('--- Recording runs (higher is better)');

r = await call('POST', '/games/speed-math/score', { score: 300, durationMs: 60000 });
check('first run -> 200', r.status === 200, JSON.stringify(r.body));
check('a first run is always a best', r.body.isBest === true && r.body.best === 300);
check('plays counted', r.body.plays === 1);
check('points on the points scale (300/10)', r.body.points === 30, String(r.body.points));

const withDuration = await db.query(
  'SELECT duration_ms FROM game_runs WHERE customer_id=$1 ORDER BY id DESC LIMIT 1', [CID]);
check('run duration stored for analytics', withDuration.rows[0].duration_ms === 60000, String(withDuration.rows[0].duration_ms));

r = await call('POST', '/games/speed-math/score', { score: 500 });
check('a better score becomes the best', r.body.isBest === true && r.body.best === 500, JSON.stringify(r.body));

r = await call('POST', '/games/speed-math/score', { score: 100 });
check('a worse score does not', r.body.isBest === false && r.body.best === 500, JSON.stringify(r.body));
check('plays keeps counting', r.body.plays === 3);
check('average is over every run, not just the best', r.body.avg === 300, String(r.body.avg));

r = await call('GET', '/games');
const sm = r.body.progress['speed-math'];
check('GET /games agrees with the submit response', sm.best === 500 && sm.plays === 3 && sm.avg === 300, JSON.stringify(sm));
check('lastPlayed recorded', typeof sm.lastPlayed === 'number' && sm.lastPlayed > 0);

out.push('--- Lower is better (Number Chase is timed)');

r = await call('POST', '/games/number-chase/score', { score: 55 });
check('first timed run -> best', r.body.isBest === true && r.body.best === 55, JSON.stringify(r.body));

r = await call('POST', '/games/number-chase/score', { score: 38 });
check('FASTER is better: 38s beats 55s', r.body.isBest === true && r.body.best === 38, JSON.stringify(r.body));

r = await call('POST', '/games/number-chase/score', { score: 90 });
check('SLOWER is not: 90s does not beat 38s', r.body.isBest === false && r.body.best === 38, JSON.stringify(r.body));

r = await call('GET', '/games');
check('the stored best is the MINIMUM, not the maximum', r.body.progress['number-chase'].best === 38, JSON.stringify(r.body.progress['number-chase']));

// Number Chase reports tenths of a second. Rounding them away would hand the
// member a personal best they never set.
r = await call('POST', '/games/number-chase/score', { score: 37.4 });
check('TENTHS SURVIVE: 37.4s is stored as 37.4, not 37', r.body.best === 37.4, JSON.stringify(r.body));
r = await call('POST', '/games/number-chase/score', { score: 37.9 });
check('and 37.9 does not beat 37.4', r.body.isBest === false && r.body.best === 37.4, JSON.stringify(r.body));

out.push('--- Level games');

r = await call('POST', '/games/memory-matrix/score', { score: 9 });
check('level run recorded', r.status === 200 && r.body.best === 9);
check('level games score on the level scale (9x15)', r.body.points === 135, String(r.body.points));

out.push('--- The score is not trusted');

r = await call('POST', '/games/speed-math/score', { score: 999999999 });
check('an absurd score is refused -> 422', r.status === 422 && r.body.code === 'invalid_score', JSON.stringify(r.body));

r = await call('POST', '/games/speed-math/score', { score: 'nonsense' });
check('a non-numeric score is refused', r.status === 422 && r.body.code === 'invalid_score');

r = await call('POST', '/games/number-chase/score', { score: 1 });
check('a superhuman time is refused', r.status === 422 && r.body.code === 'invalid_score', JSON.stringify(r.body));

r = await call('GET', '/games');
check('NOTHING was stored by the refused attempts', r.body.progress['speed-math'].plays === 3 && r.body.progress['number-chase'].plays === 5);

const maxAllowed = 750 * 8; // three-star x the plausible multiple
r = await call('POST', '/games/speed-math/score', { score: maxAllowed });
check('an exceptional but possible score IS accepted', r.status === 200 && r.body.best === maxAllowed, JSON.stringify(r.body));
check('points stay capped however high the score', r.body.points === 80, String(r.body.points));

out.push('--- Points reach the member');

const me = (await call('GET', '/me')).body;
const runs = await db.query('SELECT COALESCE(SUM(points),0)::int AS p, COUNT(*)::int AS n FROM game_runs WHERE customer_id=$1', [CID]);
check('every accepted run is a row', runs.rows[0].n === 10, String(runs.rows[0].n));
check('total points rose by exactly the game points earned', me.stats.points === pointsBefore + runs.rows[0].p, me.stats.points + ' vs ' + (pointsBefore + runs.rows[0].p));

const ledger = await db.query("SELECT COUNT(*)::int AS n FROM member_points_ledger WHERE customer_id=$1 AND source='game'", [CID]);
check('one ledger row per run', ledger.rows[0].n === 10, String(ledger.rows[0].n));

const board = (await call('GET', '/leaderboard?period=week&scope=total')).body;
check("the member's game column is real, not a 51% guess", board.me.game === runs.rows[0].p, board.me.game + ' vs ' + runs.rows[0].p);
check('the field of competitors is still the demo thirty', board.rows.length === 31);
check('the board is still stable across requests',
  JSON.stringify((await call('GET', '/leaderboard?period=week&scope=total')).body.rows) === JSON.stringify(board.rows));

out.push('--- Report reads the games');

const rep = (await call('GET', '/reports?period=month')).body;
check('GET /reports -> 200', rep.period === 'month');
check('only games actually played appear', rep.games.length === 3, JSON.stringify(rep.games.map((g) => g.slug)));
// number-chase has five runs to speed-math's four, so it leads the table.
check('busiest game first', rep.games[0].slug === 'number-chase', rep.games[0].slug + ' (' + rep.games[0].plays + ' plays)');
check('report best matches the games screen', rep.games.find((g) => g.slug === 'number-chase').best === 37.4,
  String(rep.games.find((g) => g.slug === 'number-chase').best));
check('titles and units come from the catalogue, not the table',
  rep.games.find((g) => g.slug === 'number-chase').unit === 'sec' &&
  rep.games.find((g) => g.slug === 'memory-matrix').title === 'Memory Matrix');

const dash = (await call('GET', '/dashboard')).body;
check('dashboard play count is the real number of runs', dash.totals.plays === 10, String(dash.totals.plays));
check('dashboard game strip lists the three played', dash.games.length === 3);
check('CONSISTENT: report IQ still matches the dashboard', rep.iq.value === dash.iq.value);

const all = (await call('GET', '/reports?period=all')).body;
check('period=all counts every run', all.games.length === 3);

out.push('--- The catalogue is still code, not data');

const tables = await db.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%game%')"
);
check('game_runs is the only game table', tables.rows.length === 1 && tables.rows[0].table_name === 'game_runs',
  tables.rows.map((t) => t.table_name).join(', '));

const cols = await db.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name='game_runs'"
);
const names = cols.rows.map((c) => c.column_name);
check('no title, blurb or rules stored', !names.some((n) => ['title', 'blurb', 'rules', 'stars', 'tagline'].includes(n)), names.join(', '));

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
await db.end();
process.exit(fail ? 1 : 0);
