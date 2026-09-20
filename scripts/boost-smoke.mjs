/**
 * Integration test for the Boost members' API.
 *
 *   npm run test:boost          (the server must already be running)
 *
 * Exercises the rules that are the product rather than the plumbing: one quiz a
 * day, levels unlocking at 16/20, practice earning nothing, attempts dying at
 * midnight, a reset signing every device out — and, on every response that
 * carries questions, that the answer key is not in it.
 *
 * Creates and reuses a single test member. It writes to the database, so it
 * refuses to run against production, and it touches no row belonging to anyone
 * else.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { buildLevel } from '../src/boost-engine/index.js';
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this test writes to the database and NODE_ENV is production.');
  process.exit(1);
}

const BASE = (process.env.BOOST_TEST_BASE_URL || 'http://localhost:' + (process.env.PORT || 5000)) + '/boost-api/v1';
const EMAIL = 'boost.tester@example.com';
const PASSWORD = 'K7MP-3QRT-9XYZ';
const ORIGIN = (process.env.BOOST_APP_ORIGINS || 'http://localhost:5173').split(',')[0].trim();

let token = null;
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; results.push('  PASS  ' + name); }
  else { fail++; results.push('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

async function call(method, path, body, useToken = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(useToken && token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

  // The suite makes a handful of deliberately-failing sign-ins each run, and the
  // limiter counts those across runs within its window. Hitting it means the
  // limiter works; it also means the rest of this run would report nonsense, so
  // stop with something readable instead of a null dereference twenty lines on.
  if (res.status === 429) {
    console.error(
      [
        '',
        'Rate limited on ' + method + ' ' + path + '.',
        'That is the limiter working, but the rest of this run would report nonsense.',
        'The counters are per server process, so restart the server and run this again.',
        ''
      ].join('\n')
    );
    await db.end().catch(() => {});
    process.exit(2);
  }

  return { status: res.status, body: json, headers: res.headers };
}

const db = new pg.Client({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

async function correctAnswers(publicId) {
  const r = await db.query('SELECT seed, category, level FROM boost_attempts WHERE public_id=$1', [publicId]);
  const { seed, category, level } = r.rows[0];
  const qs = buildLevel(category, level, seed);
  return Object.fromEntries(qs.map(q => [q.id, q.answer]));
}

await db.connect();

// Create the member the way a funnel purchase would: a customer with a real
// (bcrypt) password and a stamped password_set_at, a quiz result carrying the
// certificate score, and an active subscription.
const hash = await bcrypt.hash(PASSWORD, 10);
const CID = (await db.query(
  `INSERT INTO customers (email, password_hash, password_set_at, email_verified, status, created_at, updated_at)
   VALUES ($1,$2,now(),true,'active',now(),now())
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_set_at = now()
   RETURNING id`, [EMAIL, hash])).rows[0].id;

if (!(await db.query('SELECT 1 FROM customer_quiz_results WHERE customer_id=$1', [CID])).rows.length) {
  await db.query(
    `INSERT INTO customer_quiz_results (customer_id,email,first_name,last_name,age,iq_score,language,country_code,created_at,updated_at)
     VALUES ($1,$2,'Yuki','Tanaka','34',118,'en','JP',now(),now())`, [CID, EMAIL]);
}
if (!(await db.query('SELECT 1 FROM customer_subscriptions WHERE customer_id=$1', [CID])).rows.length) {
  await db.query(
    `INSERT INTO customer_subscriptions
       (customer_id,stripe_subscription_id,status,plan_name,amount,currency,current_period_start,current_period_end,
        card_brand,card_last4,card_exp_month,card_exp_year,created_at,updated_at)
     VALUES ($1,$2,'active','premium',5495,'JPY',now(),now()+interval '30 days','VISA','4242',9,2028,now(),now())`,
    [CID, 'sub_test_' + CID]);
}
await db.query('DELETE FROM member_points_ledger WHERE customer_id=$1', [CID]);
await db.query('DELETE FROM boost_attempts WHERE customer_id=$1', [CID]);
await db.query('DELETE FROM boost_level_progress WHERE customer_id=$1', [CID]);
await db.query('DELETE FROM boost_password_resets WHERE customer_id=$1', [CID]);
await db.query('UPDATE boost_profiles SET streak=0,longest_streak=0,total_points=0 WHERE customer_id=$1', [CID]);
await db.query("UPDATE customer_subscriptions SET status='active', canceled_at=null WHERE customer_id=$1", [CID]);

// Frees today's slot by re-dating existing scored attempts to distinct earlier
// days. Distinct matters: the unique index is exactly what we are testing, so
// parking two of them on the same day would collide.
async function freeToday() {
  await db.query(
    `WITH ranked AS (
       SELECT id, row_number() OVER (ORDER BY id) AS rn
       FROM boost_attempts WHERE customer_id = $1 AND is_practice = false
     )
     UPDATE boost_attempts b
     SET date_key = to_char(now() - ((ranked.rn + 1) * interval '1 day'), 'YYYY-MM-DD')
     FROM ranked WHERE b.id = ranked.id`, [CID]);
}

results.push('--- 1. Authentication');

let r = await call('POST', '/auth/login', { email: EMAIL, password: 'wrong-password' }, false);
check('wrong password -> 401 invalid_credentials', r.status === 401 && r.body.code === 'invalid_credentials', JSON.stringify(r.body));

r = await call('POST', '/auth/login', { email: 'nobody@example.com', password: PASSWORD }, false);
check('unknown email -> identical 401, no membership oracle', r.status === 401 && r.body.code === 'invalid_credentials');

r = await call('POST', '/auth/login', { email: 'newuyser324@gmail.com', password: 'anything' }, false);
check('quiz-taker with no password_set_at cannot sign in', r.status === 401 && r.body.code === 'invalid_credentials');

r = await call('POST', '/auth/login', { email: EMAIL.toUpperCase(), password: PASSWORD }, false);
check('email is case-insensitive', r.status === 200 && Boolean(r.body.token), JSON.stringify(r.body).slice(0, 160));

r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD.toLowerCase() }, false);
check('password is NOT case-normalised', r.status === 401);

r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, false);
check('correct credentials -> token + user', r.status === 200 && Boolean(r.body.token) && r.body.user?.email === EMAIL, JSON.stringify(r.body).slice(0, 200));
token = r.body.token;
check('login response carries no hash', !/password_hash|\$2[aby]\$/.test(JSON.stringify(r.body)));
check('CORS echoes the exact origin, not *', r.headers.get('access-control-allow-origin') === ORIGIN, String(r.headers.get('access-control-allow-origin')));
check('CORS allows credentials', r.headers.get('access-control-allow-credentials') === 'true');

const savedToken = token;
token = null;
r = await call('GET', '/me');
check('no token -> 401', r.status === 401 && r.body.code === 'unauthenticated');
token = 'nonsense.token.here';
r = await call('GET', '/me');
check('garbage token -> 401', r.status === 401);
token = savedToken;

results.push('--- 2. Account');

r = await call('GET', '/me');
check('GET /me -> user + subscription + stats', r.status === 200 && r.body.user && r.body.subscription && r.body.stats, JSON.stringify(r.body).slice(0, 250));
check('memberId issued', /^MIQ-\d{7}$/.test(r.body.user?.memberId ?? ''), r.body.user?.memberId);
check('estimated IQ starts at the certificate score (118)', r.body.stats?.estimatedIq === 118, String(r.body.stats?.estimatedIq));
check('subscription shows the saved card', r.body.subscription?.paymentMethod?.last4 === '4242');
// The point is that it is formatted money in the currency they bought in, not
// the prototype's `[PRICE]` placeholder — pinning the figure here would just
// make this fail every time the price list changes.
const label = r.body.subscription?.priceLabel ?? '';
check('price rendered as real money, not [PRICE]',
  /[¥￥£$]/.test(label) && /\d/.test(label) && !label.includes('PRICE'), label);
check('certificate carried from the quiz result', r.body.subscription?.certificate?.iq === 118);
check('GET /me leaks no password hash', !/password_hash/.test(JSON.stringify(r.body)));

r = await call('PATCH', '/me', { displayName: 'Yuki', notifications: { dailyReminder: false } });
check('PATCH /me updates the display name', r.status === 200 && r.body.user?.displayName === 'Yuki', JSON.stringify(r.body).slice(0, 200));
check('PATCH /me merges notifications rather than replacing', r.body.user?.notifications?.dailyReminder === false && r.body.user?.notifications?.weeklyRank === true);

r = await call('PATCH', '/me', { birthYear: 3000 });
check('PATCH /me rejects an impossible birth year', r.status === 422 && r.body.code === 'invalid_birth_year');

r = await call('PATCH', '/me', { timezone: 'Mars/Olympus' });
check('PATCH /me rejects an unknown timezone', r.status === 422 && r.body.code === 'invalid_timezone');

results.push('--- 3. Boost overview');

r = await call('GET', '/boost');
const overview = r.body;
check('GET /boost -> 6 categories', r.status === 200 && overview.categories?.length === 6);
check('pass mark 16 of 20', overview.passMark === 16 && overview.questionsPerLevel === 20);
check('today is available', overview.today?.status === 'available');
check('resetsAt is the next local midnight', overview.resetsAt > Date.now());
const memory = overview.categories.find(c => c.key === 'memory');
check('level 1 available, level 2 locked', memory.levels[0].status === 'available' && memory.levels[1].status === 'locked');

results.push('--- 4. Starting an attempt');

r = await call('POST', '/boost/attempts', { category: 'memory', level: 2 });
check('locked level refused -> 403 level_locked', r.status === 403 && r.body.code === 'level_locked', JSON.stringify(r.body));

r = await call('POST', '/boost/attempts', { category: 'telepathy', level: 1 });
check('unknown category -> 404', r.status === 404 && r.body.code === 'unknown_category');

r = await call('POST', '/boost/attempts', { category: 'memory', level: 9 });
check('unknown level -> 422', r.status === 422 && r.body.code === 'unknown_level');

r = await call('POST', '/boost/attempts', { category: 'memory', level: 1 });
const attempt = r.body.attempt;
check('start -> 20 questions', r.status === 200 && attempt?.questions?.length === 20, JSON.stringify(r.body).slice(0, 200));
check('not flagged as resumed', r.body.resumed === false);

const wire = JSON.stringify(r.body);
check('NO answer key on the wire', !/"answer"/.test(wire));
check('NO explanations on the wire', !/"explain"/.test(wire));
check('NO seed on the wire', !/"seed"/.test(wire));
check('questions carry prompt and options', attempt.questions.every(q => q.prompt && Array.isArray(q.options) && q.options.length >= 2));

r = await call('POST', '/boost/attempts', { category: 'memory', level: 1 });
check('starting the same level again resumes it', r.status === 200 && r.body.resumed === true && r.body.attempt.id === attempt.id);

r = await call('POST', '/boost/attempts', { category: 'verbal', level: 1 });
check('a second category today -> 409 attempt_in_progress', r.status === 409 && r.body.code === 'attempt_in_progress', JSON.stringify(r.body));
check('409 carries the open attempt so the UI can offer Resume', r.body.attempt?.id === attempt.id);

results.push('--- 5. Resume across devices');

r = await call('PATCH', '/boost/attempts/' + attempt.id + '/progress', {
  index: 7,
  answers: { q1: 2, q2: 0, q3: 1 },
  studied: ['q1', 'q2'],
  timing: { q1: 8400, q2: 12100 }
});
check('autosave -> 204', r.status === 204, String(r.status));

r = await call('GET', '/boost/attempts/current');
check('resume returns the same attempt', r.status === 200 && r.body.attempt.id === attempt.id);
check('resume restores the question index', r.body.attempt.progress?.index === 7, JSON.stringify(r.body.attempt.progress));
check('resume restores the answers already given', r.body.attempt.progress?.answers?.q1 === 2 && r.body.attempt.progress?.answers?.q3 === 1);
check('resume restores which memory cards were already shown', JSON.stringify(r.body.attempt.progress?.studied) === '["q1","q2"]');
check('resume still hides the answer key', !/"answer"|"seed"/.test(JSON.stringify(r.body)));

const stored = await db.query('SELECT timing_ms FROM boost_attempts WHERE public_id=$1', [attempt.id]);
check('per-question timing stored for analytics', stored.rows[0].timing_ms.q1 === 8400 && stored.rows[0].timing_ms.q2 === 12100, JSON.stringify(stored.rows[0].timing_ms));

r = await call('PATCH', '/boost/attempts/' + attempt.id + '/progress', { index: 999, answers: { 'q1; DROP TABLE x': 1, q2: 99 }, timing: { q3: -5 } });
check('autosave accepts hostile input without failing', r.status === 204);
const cleaned = await db.query('SELECT answers, current_index FROM boost_attempts WHERE public_id=$1', [attempt.id]);
check('out-of-range index clamped to the last question', cleaned.rows[0].current_index === 19, String(cleaned.rows[0].current_index));
check('bad question ids and option indexes dropped', Object.keys(cleaned.rows[0].answers).length === 0, JSON.stringify(cleaned.rows[0].answers));

results.push('--- 6. Submitting');

const answers = await correctAnswers(attempt.id);
r = await call('POST', '/boost/attempts/' + attempt.id + '/submit', { answers });
const result = r.body.result;
check('submit -> 20/20', r.status === 200 && result?.correct === 20, JSON.stringify(r.body).slice(0, 300));
check('passed', result.passed === true);
check('counted as the first completion', result.firstCompletion === true);
check('next level unlocked', result.nextUnlocked === 2);
check('points = 20x2 + 100x1 = 140', result.points === 140, String(result.points));
check('streak is now 1', r.body.streak === 1, String(r.body.streak));
check('review returned with explanations', Array.isArray(result.review) && result.review.length === 20 && result.review[0].explain !== undefined);
check('review marks every answer', result.review.every(x => typeof x.right === 'boolean'));

r = await call('POST', '/boost/attempts/' + attempt.id + '/submit', { answers });
check('submitting twice -> 409 already_submitted', r.status === 409 && r.body.code === 'already_submitted');

r = await call('GET', '/boost/attempts/current');
check('reload after submit shows the result, not the questions', r.status === 200 && r.body.result?.correct === 20 && r.body.attempt.questions === undefined);

r = await call('POST', '/boost/attempts', { category: 'verbal', level: 1 });
check('day used up -> 409 daily_limit_reached', r.status === 409 && r.body.code === 'daily_limit_reached', JSON.stringify(r.body));
check('409 tells the UI when it resets', typeof r.body.resetsAt === 'number');

r = await call('GET', '/boost');
const mem2 = r.body.categories.find(c => c.key === 'memory');
check('level 1 now completed', mem2.levels[0].status === 'completed');
check('level 2 now available', mem2.levels[1].status === 'available');
check('best score recorded', mem2.levels[0].best === 20);
check('today shows done', r.body.today.status === 'done');

const ledger = await db.query('SELECT points FROM member_points_ledger WHERE customer_id=$1', [CID]);
check('points ledger has exactly one row', ledger.rows.length === 1 && ledger.rows[0].points === 140, JSON.stringify(ledger.rows));

results.push('--- 7. Practice: replaying a completed level');

r = await call('POST', '/boost/attempts', { category: 'memory', level: 1 });
const practice = r.body.attempt;
check('completed level replays even after the day is used', r.status === 200 && practice?.practice === true, JSON.stringify(r.body).slice(0, 200));
check('practice serves a fresh set of 20', practice.questions.length === 20);
check('practice hides the answer key too', !/"answer"|"seed"/.test(JSON.stringify(r.body)));

r = await call('GET', '/boost/attempts/' + practice.id);
check('practice opens by id', r.status === 200 && r.body.attempt.id === practice.id);

r = await call('POST', '/boost/attempts/' + practice.id + '/submit', { answers: await correctAnswers(practice.id) });
check('practice submits and scores', r.status === 200 && r.body.result.correct === 20);
check('practice earns NO points', r.body.result.points === 0, String(r.body.result.points));
check('practice is flagged as practice', r.body.result.practice === true);
check('practice does not re-award first completion', r.body.result.firstCompletion === false);

const ledger2 = await db.query('SELECT count(*)::int n, coalesce(sum(points),0)::int total FROM member_points_ledger WHERE customer_id=$1', [CID]);
check('ledger unchanged by practice', ledger2.rows[0].n === 1 && ledger2.rows[0].total === 140, JSON.stringify(ledger2.rows[0]));

r = await call('GET', '/me');
check('total points reflect the scored quiz only', r.body.stats.points === 140, String(r.body.stats.points));

results.push('--- 8. A new day');

await db.query("UPDATE boost_attempts SET date_key = to_char(now() - interval '1 day','YYYY-MM-DD') WHERE customer_id=$1 AND is_practice=false", [CID]);

r = await call('POST', '/boost/attempts', { category: 'memory', level: 2 });
const day2 = r.body.attempt;
check('a new day frees the daily slot', r.status === 200 && day2?.questions?.length === 20, JSON.stringify(r.body).slice(0, 200));
check('level 2 playable now it is unlocked', day2.level === 2);

const wrong = Object.fromEntries(Object.entries(await correctAnswers(day2.id)).map(([id, a]) => [id, (a + 1) % 4]));
r = await call('POST', '/boost/attempts/' + day2.id + '/submit', { answers: wrong });
check('a failing run does not pass', r.status === 200 && r.body.result.passed === false, JSON.stringify(r.body.result).slice(0, 200));
check('a failing run unlocks nothing', r.body.result.nextUnlocked === null);
check('streak counts the day whether or not it passed', r.body.streak === 2, String(r.body.streak));

r = await call('GET', '/boost');
const mem3 = r.body.categories.find(c => c.key === 'memory');
check('failed level stays available, not locked', mem3.levels[1].status === 'available');
check('level 3 still locked', mem3.levels[2].status === 'locked');
check('completion survives a later lower score', mem3.levels[0].status === 'completed' && mem3.levels[0].best === 20);

results.push('--- 9. Expiry at midnight');

await freeToday();
r = await call('POST', '/boost/attempts', { category: 'verbal', level: 1 });
const stale = r.body.attempt;
check('fresh attempt started', r.status === 200 && Boolean(stale?.id), JSON.stringify(r.body).slice(0, 160));
await db.query("UPDATE boost_attempts SET expires_at = now() - interval '1 minute' WHERE public_id=$1", [stale.id]);

r = await call('POST', '/boost/attempts/' + stale.id + '/submit', { answers: {} });
check('submitting after midnight -> 410 attempt_expired', r.status === 410 && r.body.code === 'attempt_expired', JSON.stringify(r.body));

r = await call('GET', '/boost/attempts/' + stale.id);
check('an expired attempt cannot be reopened', r.status === 410 && r.body.code === 'attempt_closed');

results.push('--- 10. Ownership');

const other = await db.query('SELECT public_id FROM boost_attempts WHERE customer_id <> $1 LIMIT 1', [CID]);
if (other.rows.length) {
  r = await call('GET', '/boost/attempts/' + other.rows[0].public_id);
  check('another member attempt -> 404', r.status === 404);
} else {
  check('another member attempt -> 404 (none to try)', true);
}
r = await call('GET', '/boost/attempts/att_doesnotexist');
check('unknown attempt id -> 404', r.status === 404 && r.body.code === 'not_found');

results.push('--- 11. Personality');

await freeToday();
r = await call('POST', '/boost/attempts', { category: 'personality', level: 1 });
const pers = r.body.attempt;
check('personality starts', r.status === 200 && pers?.questions?.length === 20, JSON.stringify(r.body).slice(0, 160));
check('personality questions are likert with 5 options', pers.questions.every(q => q.type === 'likert' && q.options.length === 5));
check('personality hides trait and key', !/"trait"|"key"/.test(JSON.stringify(r.body)));

r = await call('POST', '/boost/attempts/' + pers.id + '/submit', {
  answers: Object.fromEntries(pers.questions.map((q, i) => [q.id, i % 5]))
});
check('personality passes on completion', r.status === 200 && r.body.result.passed === true, JSON.stringify(r.body.result).slice(0, 200));
check('personality is unscored', r.body.result.unscored === true);
check('personality returns a Big Five profile', r.body.result.profile && Object.keys(r.body.result.profile).sort().join('') === 'ACEOS', JSON.stringify(r.body.result.profile));

r = await call('GET', '/boost');
check('profile shown on the overview', Boolean(r.body.personality?.traits) && typeof r.body.personality.level === 'number');

results.push('--- 12. Dashboard and leaderboard');

r = await call('GET', '/dashboard');
check('GET /dashboard -> 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
check('week strip has 7 days', r.body.week?.length === 7);
check('IQ history has 12 months', r.body.iq?.history?.length === 12);
check('levels total is 30', r.body.totals?.levelsTotal === 30);
check('levels done counted', r.body.totals?.levelsDone >= 1);

r = await call('GET', '/leaderboard?period=week&scope=total');
check('GET /leaderboard -> 200', r.status === 200 && Array.isArray(r.body.rows));
check('leaderboard exposes no email addresses', !/@/.test(JSON.stringify(r.body.rows)), JSON.stringify(r.body.rows).slice(0, 200));

results.push('--- 13. Password reset');

r = await call('POST', '/auth/forgot-password', { email: EMAIL }, false);
check('forgot password -> 200', r.status === 200 && r.body.ok === true);
check('no dev token handed to the client', r.body.devResetToken === undefined);

r = await call('POST', '/auth/forgot-password', { email: 'nobody-at-all@example.com' }, false);
check('unknown address -> still 200, no oracle', r.status === 200 && r.body.ok === true);

const resets = await db.query('SELECT token_hash FROM boost_password_resets WHERE customer_id=$1 ORDER BY id DESC', [CID]);
check('only the token hash is stored', resets.rows.length >= 1 && /^[0-9a-f]{64}$/.test(resets.rows[0].token_hash));

r = await call('POST', '/auth/reset-password', { token: 'made-up', password: 'newpass123' }, false);
check('bad token -> 400 invalid_token', r.status === 400 && r.body.code === 'invalid_token');

const realToken = crypto.randomBytes(32).toString('hex');
await db.query(
  "INSERT INTO boost_password_resets (customer_id, token_hash, expires_at, created_at) VALUES ($1,$2,now() + interval '1 hour', now())",
  [CID, crypto.createHash('sha256').update(realToken).digest('hex')]);

r = await call('POST', '/auth/reset-password', { token: realToken, password: 'short' }, false);
check('short password -> 422 weak_password', r.status === 422 && r.body.code === 'weak_password');

r = await call('POST', '/auth/reset-password', { token: realToken, password: 'lettersonly' }, false);
check('no digit -> 422 weak_password', r.status === 422 && r.body.code === 'weak_password');

const oldToken = token;
r = await call('POST', '/auth/reset-password', { token: realToken, password: 'NewPassw0rd' }, false);
check('valid reset -> 200', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

token = oldToken;
r = await call('GET', '/me');
check('RESET SIGNS OUT EVERY DEVICE: old token rejected', r.status === 401 && r.body.code === 'session_expired', JSON.stringify(r.body));

r = await call('POST', '/auth/reset-password', { token: realToken, password: 'AnotherPass1' }, false);
check('reset token is single use', r.status === 400 && r.body.code === 'invalid_token');

r = await call('POST', '/auth/login', { email: EMAIL, password: 'NewPassw0rd' }, false);
check('new password works', r.status === 200 && Boolean(r.body.token));
token = r.body.token;

r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, false);
check('old password no longer works', r.status === 401);

r = await call('GET', '/me');
// 140 for memory L1, 0 for the failed L2, 140 for completing personality L1
// (20 statements answered x2, plus the 100 x level completion bonus).
check('progress survived the reset', r.status === 200 && r.body.stats.points === 280, JSON.stringify(r.body.stats));

results.push('--- 14. Subscription gate');

await db.query("UPDATE customer_subscriptions SET status='canceled', canceled_at=now() WHERE customer_id=$1", [CID]);
r = await call('GET', '/me');
check('cancelled member can STILL sign in and read /me', r.status === 200, String(r.status));
r = await call('GET', '/boost');
check('cancelled member still sees their history', r.status === 200);
r = await call('POST', '/boost/attempts', { category: 'verbal', level: 1 });
check('cancelled member cannot train -> 403, not 401', r.status === 403 && r.body.code === 'subscription_required', JSON.stringify(r.body));

await db.query("UPDATE customer_subscriptions SET status='past_due', canceled_at=null WHERE customer_id=$1", [CID]);
r = await call('GET', '/boost/attempts/current');
check('past_due keeps access: a failed card is not a cancellation', r.status !== 403, String(r.status));
await db.query("UPDATE customer_subscriptions SET status='active' WHERE customer_id=$1", [CID]);

console.log('\n' + results.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');

await db.end();
process.exit(fail ? 1 : 0);
