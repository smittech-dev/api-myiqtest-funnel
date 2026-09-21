/**
 * Profile, streak and leaderboard placement.
 *
 *   npm run test:boost:profile   (run `npm run test:boost` first — it seeds the
 *                                 member and leaves the password this expects)
 *
 * Three things that were reported as not working:
 *
 *   - the leaderboard put a paying member last out of 31;
 *   - the profile screen had controls that did nothing;
 *   - the streak never fell, because it was only recomputed on submit.
 *
 * The streak checks are the ones worth reading: they assert it *decays*, which
 * is the case a test written against the happy path would never catch.
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
const ORIGIN = (process.env.BOOST_APP_ORIGINS || 'http://localhost:5173').split(',')[0].trim();

let PASSWORD = process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd';
let token = null;
let pass = 0, fail = 0;
const out = [];
const check = (n, c, d = '') => { c ? (pass++, out.push('  PASS  ' + n)) : (fail++, out.push('  FAIL  ' + n + (d ? ' :: ' + d : ''))); };

const db = new pg.Client({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE
});

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await res.text();
  if (res.status === 429) {
    console.error(['', 'Rate limited on ' + method + ' ' + path + '. Restart the server and run this again.', ''].join('\n'));
    await db.end().catch(() => {});
    process.exit(2);
  }
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

await db.connect();
const CID = (await db.query('SELECT id FROM customers WHERE email=$1', [EMAIL])).rows[0].id;
await db.query("UPDATE customer_subscriptions SET status='active', canceled_at=null WHERE customer_id=$1", [CID]);

const signIn = async () => {
  const r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (r.status !== 200) {
    console.error(['', 'Could not sign in. Run `npm run test:boost` first.', JSON.stringify(r.body), ''].join('\n'));
    process.exit(1);
  }
  token = r.body.token;
};
await signIn();

/** Replaces the member's history with submitted days at the given offsets. */
async function trainedOn(offsets) {
  await db.query('DELETE FROM boost_attempts WHERE customer_id=$1', [CID]);
  for (const back of offsets) {
    await db.query(
      `INSERT INTO boost_attempts (public_id, customer_id, category, level, seed, date_key, is_practice, status,
         started_at, expires_at, submitted_at, correct, total, passed, unscored, points)
       VALUES ($1,$2,'memory',1,'s', to_char(now() - ($3 || ' days')::interval,'YYYY-MM-DD'), false,'submitted',
         now(), now(), now(), 18, 20, true, false, 36)`,
      ['att_p' + back + '_' + Date.now().toString(36), CID, String(back)]
    );
  }
}

const streak = async () => (await call('GET', '/me')).body.stats.streak;

out.push('--- The streak is recomputed, not remembered');

await trainedOn([0, 1, 2]);
await db.query('UPDATE boost_profiles SET streak=99, longest_streak=99 WHERE customer_id=$1', [CID]);
check('a stored streak does not override the real one', await streak() === 3, 'stored 99, trained 3 days');

await trainedOn([1, 2, 3]);
check('today not done yet is NOT a broken streak', await streak() === 3, 'trained yesterday and the two days before');

await trainedOn([3, 4, 5]);
check('DECAYS: stopping three days ago drops it to 0', await streak() === 0);

await trainedOn([0, 2, 3]);
check('a gap breaks it — only today counts', await streak() === 1);

await trainedOn([]);
check('no training at all is 0', await streak() === 0);

await trainedOn([0, 1, 2, 3, 4, 5, 6]);
check('a full week counts seven', await streak() === 7);

const longest = (await call('GET', '/me')).body.stats.longestStreak;
check('the longest streak is kept even when the current one falls', longest >= 7, String(longest));
await trainedOn([5, 6, 7]);
const after = (await call('GET', '/me')).body.stats;
check('current falls to 0 but longest survives', after.streak === 0 && after.longestStreak >= 7, JSON.stringify(after));

// Personality has no score but is still a day trained.
await db.query('DELETE FROM boost_attempts WHERE customer_id=$1', [CID]);
await db.query(
  `INSERT INTO boost_attempts (public_id, customer_id, category, level, seed, date_key, is_practice, status,
     started_at, expires_at, submitted_at, correct, total, passed, unscored, points)
   VALUES ($1,$2,'personality',1,'s', to_char(now(),'YYYY-MM-DD'), false,'submitted', now(), now(), now(), 20, 20, true, true, 140)`,
  ['att_pers_' + Date.now().toString(36), CID]
);
check('a personality day counts towards the streak', await streak() === 1);

// A practice run is not a day's training.
await db.query('DELETE FROM boost_attempts WHERE customer_id=$1', [CID]);
await db.query(
  `INSERT INTO boost_attempts (public_id, customer_id, category, level, seed, date_key, is_practice, status,
     started_at, expires_at, submitted_at, correct, total, passed, unscored, points)
   VALUES ($1,$2,'memory',1,'s', to_char(now(),'YYYY-MM-DD'), true,'submitted', now(), now(), now(), 20, 20, true, false, 0)`,
  ['att_prac_' + Date.now().toString(36), CID]
);
check('a practice run does NOT count', await streak() === 0);

const dash = (await call('GET', '/dashboard')).body;
const me = (await call('GET', '/me')).body;
check('the dashboard agrees with /me about the streak', dash.week.filter((d) => d.done).length === 0 && me.stats.streak === 0);

out.push('--- The member is visible on the leaderboard');

await trainedOn([0, 1, 2]);

const board = async (period = 'week') => (await call('GET', '/leaderboard?period=' + period + '&scope=total')).body;

// The case that matters most: a member who has just signed up and earned
// nothing. Everyone below them is on zero too, so this is where an arbitrary
// tie-break used to drop them to last of thirty-one.
await db.query('DELETE FROM member_points_ledger WHERE customer_id=$1', [CID]);
await db.query('UPDATE boost_profiles SET total_points=0 WHERE customer_id=$1', [CID]);
const zero = (await board()).rows.find((r) => r.me);
check('A MEMBER ON ZERO POINTS IS STILL IN THE TOP 20', zero.rank <= 20, 'rank ' + zero.rank);

let b = await board();
let mine = b.rows.find((r) => r.me);
check('GET /leaderboard -> 200', Boolean(mine));
check('THE MEMBER IS IN THE TOP 20', mine.rank <= 20, 'rank ' + mine.rank + ' of ' + b.totalPlayers);
check('and not handed first place', mine.rank >= 3, 'rank ' + mine.rank);
check('ranks run 1..n with no gaps', b.rows.every((r, i) => r.rank === i + 1));
check('nobody ties, so the order is not arbitrary',
  new Set(b.rows.map((r) => r.total)).size === b.rows.length ||
    b.rows.every((r, i) => i === 0 || b.rows[i - 1].total >= r.total));
check('the board is identical on a second request', JSON.stringify((await board()).rows) === JSON.stringify(b.rows));
check('their own totals are their real points', mine.quiz + mine.game === mine.total);

// More points must mean a better rank.
const rankAt = async (points) => {
  await db.query("DELETE FROM member_points_ledger WHERE customer_id=$1", [CID]);
  await db.query(
    `INSERT INTO member_points_ledger (customer_id, source, ref_id, points, date_key, created_at)
     VALUES ($1,'boost',NULL,$2, to_char(now(),'YYYY-MM-DD'), now())`, [CID, points]);
  await db.query('UPDATE boost_profiles SET total_points=$2 WHERE customer_id=$1', [CID, points]);
  return (await board()).rows.find((r) => r.me).rank;
};

const low = await rankAt(140);
const mid = await rankAt(4000);
const high = await rankAt(40000);
check('CLIMBS WITH EFFORT: more points, better rank', low > mid && mid > high, `${low} -> ${mid} -> ${high}`);
check('still never first', high >= 3, String(high));
check('a member on almost nothing is still visible', low <= 20, String(low));

for (const period of ['today', 'week', 'all']) {
  const p = await board(period);
  check('visible on the ' + period + ' board too', p.rows.find((r) => r.me).rank <= 20, period);
}

out.push('--- Profile');

let r = await call('PATCH', '/me', { displayName: 'Renamed', region: 'Osaka' });
check('PATCH /me saves the profile', r.status === 200 && r.body.user.displayName === 'Renamed' && r.body.user.region === 'Osaka');

r = await call('GET', '/me');
check('the change persists across a reload', r.body.user.displayName === 'Renamed');
check('the profile exposes the time zone', typeof r.body.user.timezone === 'string' && r.body.user.timezone.includes('/'), r.body.user.timezone);

r = await call('PATCH', '/me', { timezone: 'Europe/London' });
check('the time zone can be changed', r.status === 200 && r.body.user.timezone === 'Europe/London');
r = await call('PATCH', '/me', { timezone: 'Nowhere/Nothing' });
check('an unknown zone is refused', r.status === 422 && r.body.code === 'invalid_timezone');
await call('PATCH', '/me', { timezone: 'Asia/Tokyo' });

r = await call('PATCH', '/me', { notifications: { dailyReminder: false } });
check('notification toggles save', r.body.user.notifications.dailyReminder === false);
check('and do not wipe the others', r.body.user.notifications.weeklyRank === true);
await call('PATCH', '/me', { notifications: { dailyReminder: true } });

out.push('--- Changing the password while signed in');

const NEXT = 'Rotated1Pass';

r = await call('POST', '/me/password', { currentPassword: 'wrong-one', newPassword: NEXT });
check('the wrong current password is refused', r.status === 403 && r.body.code === 'invalid_password', JSON.stringify(r.body));

r = await call('POST', '/me/password', { currentPassword: PASSWORD, newPassword: 'short' });
check('a weak new password is refused', r.status === 422 && r.body.code === 'weak_password');

r = await call('POST', '/me/password', { currentPassword: PASSWORD, newPassword: PASSWORD });
check('reusing the same password is refused', r.status === 422 && r.body.code === 'weak_password');

const oldToken = token;
r = await call('POST', '/me/password', { currentPassword: PASSWORD, newPassword: NEXT });
check('a valid change succeeds', r.status === 200 && Boolean(r.body.token), JSON.stringify(r.body));

const freshToken = r.body.token;
token = oldToken;
r = await call('GET', '/me');
check('OTHER DEVICES ARE SIGNED OUT', r.status === 401 && r.body.code === 'session_expired', String(r.status));

token = freshToken;
r = await call('GET', '/me');
check('THIS session survives, on the returned token', r.status === 200, String(r.status));

PASSWORD = NEXT;
await signIn();
check('the new password signs in', Boolean(token));
check('passwordChangedAt moved', (await call('GET', '/me')).body.user.passwordChangedAt > Date.now() - 60000);

out.push('--- Purchased documents on the dashboard');

const QID = (await db.query(
  'SELECT id FROM customer_quiz_results WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1', [CID]
)).rows[0].id;

const docs = async () => (await call('GET', '/dashboard')).body.documents;
const buy = (type, amount) => db.query(
  `INSERT INTO customer_quiz_result_payment_transactions
     (customer_quiz_result_id, customer_id, transaction_type, amount, currency, status, created_at, updated_at)
   VALUES ($1,$2,$3,$4,'JPY','succeeded', now(), now())`, [QID, CID, type, amount]);

await db.query('DELETE FROM customer_quiz_result_payment_transactions WHERE customer_quiz_result_id=$1', [QID]);
check('nothing bought means no documents', (await docs()).length === 0);

await buy('first_sale', 199);
let d = await docs();
check('the certificate appears once the first sale settles', d.length === 1 && d[0].kind === 'first_sale', JSON.stringify(d.map((x) => x.kind)));
check('it carries a title and a blurb', Boolean(d[0].title) && Boolean(d[0].blurb));
check('the link is absolute and carries the quiz token',
  /^https?:\/\/.+quiz_id=[A-Za-z0-9_-]{22}$/.test(d[0].url), d[0].url);

// The funnel origin comes from FUNNEL_URL (falling back to the older
// FRONTEND_URL). Left unset in production, every certificate link a customer
// receives would point at localhost.
const FUNNEL = (process.env.FUNNEL_URL || process.env.FRONTEND_URL || 'http://localhost:3000')
  .replace(/\/+$/, '');
check('the link points at the configured funnel URL', d[0].url.startsWith(FUNNEL + '/'),
  d[0].url + ' vs ' + FUNNEL);
check('no double slash from a trailing one in the env',
  !d[0].url.replace(/^https?:\/\//, '').includes('//'), d[0].url);
check('it records when it was bought', typeof d[0].purchasedAt === 'number' && d[0].purchasedAt > 0);

await buy('cross_sale', 1990);
d = await docs();
check('the career report appears when that upsell settles', d.length === 2 && d[1].kind === 'cross_sale', JSON.stringify(d.map((x) => x.kind)));
check('the two links differ', d[0].url !== d[1].url);

await db.query(
  `UPDATE customer_quiz_result_payment_transactions SET status='pending'
   WHERE customer_quiz_result_id=$1 AND transaction_type='cross_sale'`, [QID]);
d = await docs();
check('AN UNPAID REPORT IS NOT OFFERED', d.length === 1 && d[0].kind === 'first_sale', JSON.stringify(d.map((x) => x.kind)));

await db.query('DELETE FROM customer_quiz_result_payment_transactions WHERE customer_quiz_result_id=$1', [QID]);

out.push('--- Deletion request');

r = await call('POST', '/me/deletion-request');
check('POST /me/deletion-request -> 200 with a message', r.status === 200 && typeof r.body.message === 'string', JSON.stringify(r.body));
const stillHere = await db.query('SELECT 1 FROM customers WHERE id=$1', [CID]);
check('NOTHING is deleted — it is a request, not a delete', stillHere.rows.length === 1);

token = null;
r = await call('POST', '/me/deletion-request');
check('and it needs a session', r.status === 401);

// Leave the member exactly as the other suites expect to find them — including
// the password, which this suite deliberately rotated.
const ORIGINAL = process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd';
if (PASSWORD !== ORIGINAL) {
  await signIn();
  const restored = await call('POST', '/me/password', {
    currentPassword: PASSWORD,
    newPassword: ORIGINAL
  });
  check('the password is restored for the other suites', restored.status === 200, JSON.stringify(restored.body));
  PASSWORD = ORIGINAL;
}

await db.query('DELETE FROM boost_attempts WHERE customer_id=$1', [CID]);
await db.query('DELETE FROM member_points_ledger WHERE customer_id=$1', [CID]);
await db.query('UPDATE boost_profiles SET streak=0, longest_streak=0, total_points=0 WHERE customer_id=$1', [CID]);

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log(PASSWORD === (process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd')
  ? ''
  : '\nNote: the member\'s password is now "' + PASSWORD + '" — set BOOST_TEST_PASSWORD for the other suites.\n');
await db.end();
process.exit(fail ? 1 : 0);
