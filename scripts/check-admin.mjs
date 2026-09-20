/**
 * Admin filters, search, and the shortened quiz token.
 *
 *   npm run check:admin      (the server must already be running)
 *
 * Covers the four things that changed together:
 *
 *   - the quiz token is short, reversible, and old links still open;
 *   - the admin quiz search finds a quiz by raw id, by token, or by email;
 *   - date filters honour a time, not just a day;
 *   - the "yesterday" window returns yesterday and nothing either side of it.
 *
 * Creates a handful of quiz rows at known timestamps and removes them again.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this test writes to the database and NODE_ENV is production.');
  process.exit(1);
}

const { EncryptionUtil } = await import('../src/utils/encryption.util.ts');

const BASE = process.env.BOOST_TEST_BASE_URL || 'http://localhost:' + (process.env.PORT || 5000);
const MARKER = 'admin.filter.probe@example.com';

let token = null;
let pass = 0, fail = 0;
const out = [];
const check = (n, c, d = '') => { c ? (pass++, out.push('  PASS  ' + n)) : (fail++, out.push('  FAIL  ' + n + (d ? ' :: ' + d : ''))); };

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
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

/* ── 1. the token itself ──────────────────────────────────────────────────── */

out.push('--- The quiz token');

const sample = EncryptionUtil.encryptId('8421');
check('a token is 22 characters, not 87', sample.length === 22, sample.length + ': ' + sample);
check('it round-trips', EncryptionUtil.decryptId(sample) === '8421');
check('it is URL-safe', /^[A-Za-z0-9_-]+$/.test(sample), sample);
check('the same id always gives the same token', EncryptionUtil.encryptId('8421') === sample);
check('different ids give unrelated tokens', EncryptionUtil.encryptId('8422') !== sample);

// A token minted by the previous scheme, from a link already in someone's inbox.
const legacy = 'OGQ1NTQ5ODY3ZmJmODdiMmY4ODdmMDBiODkwNjZlYjA6MDdkMDRhZWNiMGI1M2RiMzc0YTU3NmRlOTdmYjA5ZTk';
check('LINKS ALREADY SENT STILL OPEN', EncryptionUtil.decryptId(legacy) === '8421', 'legacy token');

let forged = 0;
for (let i = 0; i < 3000; i++) {
  const junk = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  if (EncryptionUtil.tryDecryptId(junk) !== null) forged += 1;
}
check('random tokens are refused (3000 tried)', forged === 0, String(forged) + ' accepted');

const tampered = Buffer.from(sample, 'base64url');
tampered[3] ^= 0x40;
check('a flipped bit is refused', EncryptionUtil.tryDecryptId(tampered.toString('base64url')) === null);
check('garbage is refused', EncryptionUtil.tryDecryptId('not-a-token') === null);

check('a big id still fits', EncryptionUtil.decryptId(EncryptionUtil.encryptId('9223372036854775807')) === '9223372036854775807');

/* ── seed rows at known instants ──────────────────────────────────────────── */

await db.query('DELETE FROM customer_quiz_results WHERE email = $1', [MARKER]);

// Three today at fixed hours, one yesterday, one the day before.
const seeds = [
  ['today 02:00', "date_trunc('day', now()) + interval '2 hours'"],
  ['today 10:30', "date_trunc('day', now()) + interval '10 hours 30 minutes'"],
  ['today 22:00', "date_trunc('day', now()) + interval '22 hours'"],
  ['yesterday 13:00', "date_trunc('day', now()) - interval '1 day' + interval '13 hours'"],
  ['two days ago', "date_trunc('day', now()) - interval '2 days' + interval '13 hours'"]
];

const ids = {};
for (const [label, expr] of seeds) {
  const r = await db.query(
    `INSERT INTO customer_quiz_results (email, first_name, iq_score, language, country_code, created_at, updated_at)
     VALUES ($1, 'Probe', 118, 'en', 'GB', ${expr}, now()) RETURNING id`,
    [MARKER]
  );
  ids[label] = r.rows[0].id;
}

/* ── 2. admin search ──────────────────────────────────────────────────────── */

// A dedicated admin for this suite, created here rather than borrowing a real
// operator's account — so no existing password is reset to run a test.
const ADMIN_EMAIL = 'admin.probe@example.com';
const ADMIN_PASSWORD = 'ProbeAdmin1!';

await db.query(
  `INSERT INTO users (name, email, password_hash, role, status, created_at, updated_at)
   VALUES ('Filter Probe', $1, $2, 'admin', 'active', now(), now())
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'`,
  [ADMIN_EMAIL, await bcrypt.hash(ADMIN_PASSWORD, 10)]
);

let login = await call('POST', '/admin/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (login.status !== 200) {
  out.push('--- Admin API');
  out.push('  FAIL  could not sign in as the probe admin :: ' + JSON.stringify(login.body));
  fail += 1;
} else {
  token = login.body?.data?.token ?? login.body?.token;

  const list = async (params) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null));
    const r = await call('GET', '/admin/quiz-submissions?' + qs);
    return { status: r.status, items: r.body?.data?.items ?? r.body?.items ?? [] };
  };

  const probeId = ids['today 10:30'];
  const probeToken = EncryptionUtil.encryptId(probeId);

  out.push('--- Admin quiz search');

  let r = await list({ search: probeId });
  check('finds a quiz by its raw database id', r.items.some((q) => String(q.id) === String(probeId)), JSON.stringify(r.items.map((q) => q.id)));

  r = await list({ search: probeToken });
  check('FINDS A QUIZ BY ITS TOKEN (the id from a result link)',
    r.items.length === 1 && String(r.items[0].id) === String(probeId),
    probeToken + ' -> ' + JSON.stringify(r.items.map((q) => q.id)));

  r = await list({ search: MARKER });
  check('finds quizzes by email', r.items.length >= 5, String(r.items.length));

  r = await list({ search: 'definitely-not-a-real-token' });
  check('an unrecognised token is not an error, just no match', r.status === 200);

  r = await list({ search: EncryptionUtil.encryptId('99999999') });
  check('a valid token for a missing quiz returns nothing', r.items.length === 0);

  out.push('--- Date filters honour the time');

  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  };
  const at = (date, h, m) => {
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  r = await list({ search: MARKER, from: at(day(0), 0, 0), to: at(day(0), 23, 59) });
  check('a whole day returns that day only', r.items.length === 3, String(r.items.length));

  r = await list({ search: MARKER, from: at(day(0), 9, 0), to: at(day(0), 12, 0) });
  check('TIME NARROWS IT: 09:00-12:00 returns only the 10:30 row',
    r.items.length === 1 && String(r.items[0].id) === String(ids['today 10:30']),
    String(r.items.length));

  r = await list({ search: MARKER, from: at(day(0), 0, 0), to: at(day(0), 9, 0) });
  check('00:00-09:00 returns only the 02:00 row',
    r.items.length === 1 && String(r.items[0].id) === String(ids['today 02:00']), String(r.items.length));

  r = await list({ search: MARKER, from: at(day(0), 23, 0), to: at(day(0), 23, 59) });
  check('a window with nothing in it returns nothing', r.items.length === 0, String(r.items.length));

  out.push('--- Yesterday');

  r = await list({ search: MARKER, from: at(day(-1), 0, 0), to: at(day(-1), 23, 59) });
  check('YESTERDAY returns yesterday only',
    r.items.length === 1 && String(r.items[0].id) === String(ids['yesterday 13:00']),
    String(r.items.length));
  check('yesterday excludes today', !r.items.some((q) => String(q.id) === String(ids['today 10:30'])));
  check('yesterday excludes the day before', !r.items.some((q) => String(q.id) === String(ids['two days ago'])));

  r = await list({ search: MARKER, from: at(day(-1), 0, 0), to: at(day(0), 23, 59) });
  check('a two-day window spans both', r.items.length === 4, String(r.items.length));

  r = await list({ search: MARKER, from: at(day(0), 12, 0), to: at(day(0), 9, 0) });
  check('an inverted range is rejected', r.status === 400, String(r.status));
}

await db.query('DELETE FROM customer_quiz_results WHERE email = $1', [MARKER]);

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? '' : '') + '\n');
await db.end();
process.exit(fail ? 1 : 0);
