/**
 * Cross-device resume, end to end.
 *
 *   npm run test:boost:resume   (run `npm run test:boost` first — it seeds the
 *                                member and leaves the password it expects)
 *
 * Two independent sessions, sharing nothing but the server: a laptop starts a
 * quiz and answers five questions, a phone picks it up mid-quiz and finishes
 * it. This is the behaviour sessionStorage alone could never provide.
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this test writes to the database and NODE_ENV is production.');
  process.exit(1);
}

const BASE = 'http://localhost:5000/boost-api/v1';
const EMAIL = 'boost.tester@example.com';
const PASSWORD = process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd';
const ORIGIN = 'http://localhost:5173';

let pass = 0, fail = 0;
const out = [];
const check = (n, c, d = '') => { c ? (pass++, out.push('  PASS  ' + n)) : (fail++, out.push('  FAIL  ' + n + (d ? ' :: ' + d : ''))); };

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

const db = new pg.Client({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE
});
await db.connect();
const CID = (await db.query('SELECT id FROM customers WHERE email=$1', [EMAIL])).rows[0].id;
await db.query('DELETE FROM member_points_ledger WHERE customer_id=$1', [CID]);
await db.query('DELETE FROM boost_attempts WHERE customer_id=$1', [CID]);
await db.query('DELETE FROM boost_level_progress WHERE customer_id=$1', [CID]);
await db.query("UPDATE customer_subscriptions SET status='active' WHERE customer_id=$1", [CID]);

// Two independent sessions — a laptop and a phone.
const laptop = (await call(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD, remember: true })).body.token;
const phone = (await call(null, 'POST', '/auth/login', { email: EMAIL, password: PASSWORD, remember: false })).body.token;
check('two devices can hold sessions at once', Boolean(laptop) && Boolean(phone) && laptop !== phone);

// Laptop starts a quiz and answers the first five questions.
let r = await call(laptop, 'POST', '/boost/attempts', { category: 'numerical', level: 1 });
const a = r.body.attempt;
check('laptop starts a quiz', r.status === 200 && a.questions.length === 20);

const firstFive = Object.fromEntries(a.questions.slice(0, 5).map((q, i) => [q.id, i % 4]));
r = await call(laptop, 'PATCH', '/boost/attempts/' + a.id + '/progress', {
  index: 4, answers: firstFive, studied: [], timing: { q1: 9000, q2: 4000, q3: 15000, q4: 2000, q5: 7500 }
});
check('laptop autosaves after five answers', r.status === 204);

// Phone picks it up. Nothing is shared between them but the server.
r = await call(phone, 'GET', '/boost/attempts/current');
const onPhone = r.body.attempt;
check('phone sees the same attempt', r.status === 200 && onPhone.id === a.id);
check('phone lands on question 5, not question 1', onPhone.progress.index === 4, String(onPhone.progress.index));
check('phone has the five answers already given', Object.keys(onPhone.progress.answers).length === 5, JSON.stringify(onPhone.progress.answers));
check('phone gets the identical questions back', JSON.stringify(onPhone.questions.map(q => q.prompt)) === JSON.stringify(a.questions.map(q => q.prompt)));
check('phone still gets no answer key', !/"answer"|"seed"|"explain"/.test(JSON.stringify(r.body)));
check('accumulated timing travels with it', onPhone.progress.timing.q3 === 15000, JSON.stringify(onPhone.progress.timing));

// Phone answers the rest and submits.
r = await call(phone, 'PATCH', '/boost/attempts/' + a.id + '/progress', {
  index: 19,
  answers: { ...firstFive, ...Object.fromEntries(onPhone.questions.slice(5).map((q, i) => [q.id, i % 4])) },
  studied: [],
  timing: { ...onPhone.progress.timing, q20: 3000 }
});
check('phone autosaves the rest', r.status === 204);

r = await call(phone, 'POST', '/boost/attempts/' + a.id + '/submit', { answers: {} });
check('an empty final payload does NOT discard the autosaved answers',
  r.status === 200 && r.body.result.review.filter(x => x.given !== null).length === 20,
  'answered=' + r.body.result.review.filter(x => x.given !== null).length);

// The laptop, still open on the old screen, must see the finished state.
r = await call(laptop, 'GET', '/boost/attempts/current');
check('laptop now sees the result, not the questions', r.status === 200 && r.body.result !== null && r.body.attempt.questions === undefined);

const row = (await db.query('SELECT timing_ms, duration_ms FROM boost_attempts WHERE public_id=$1', [a.id])).rows[0];
check('per-question timing survived to the finished row', Object.keys(row.timing_ms).length >= 5, JSON.stringify(row.timing_ms).slice(0, 120));
check('run duration recorded', row.duration_ms > 0, String(row.duration_ms));

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
await db.end();
process.exit(fail ? 1 : 0);
