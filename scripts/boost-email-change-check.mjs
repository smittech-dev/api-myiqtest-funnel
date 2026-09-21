/**
 * Changing the email address on a members' account.
 *
 *   npm run test:boost:email   (run `npm run test:boost` first — it seeds the
 *                               member and leaves the password this expects)
 *
 * The flow exists to make three things impossible, and those are what this
 * asserts:
 *
 *   - a live session alone cannot move the account (the password is required);
 *   - a typo cannot lock a paying member out (nothing moves until the new
 *     address is confirmed);
 *   - a takeover cannot be silent (the old address is always told).
 *
 * Restores the member to their original address at the end.
 */
import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this test writes to the database and NODE_ENV is production.');
  process.exit(1);
}

const BASE = (process.env.BOOST_TEST_BASE_URL || 'http://localhost:' + (process.env.PORT || 5000)) + '/boost-api/v1';
const ORIGINAL_EMAIL = 'boost.tester@example.com';
const MOVED_EMAIL = 'boost.tester.moved@example.com';
const PASSWORD = process.env.BOOST_TEST_PASSWORD || 'NewPassw0rd';
const ORIGIN = (process.env.BOOST_APP_ORIGINS || 'http://localhost:5173').split(',')[0].trim();

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

// Start from a known state: the member on their original address, no other
// account holding the one we are about to move to.
await db.query('DELETE FROM customers WHERE email = $1', [MOVED_EMAIL]);
await db.query('UPDATE customers SET email = $1 WHERE email = $2', [ORIGINAL_EMAIL, MOVED_EMAIL]);
const CID = (await db.query('SELECT id FROM customers WHERE email=$1', [ORIGINAL_EMAIL])).rows[0].id;
await db.query('DELETE FROM boost_email_changes WHERE customer_id=$1', [CID]);

const signIn = async (email = ORIGINAL_EMAIL) => {
  const r = await call('POST', '/auth/login', { email, password: PASSWORD });
  if (r.status !== 200) {
    console.error(['', 'Could not sign in as ' + email + '. Run `npm run test:boost` first.', JSON.stringify(r.body), ''].join('\n'));
    process.exit(1);
  }
  token = r.body.token;
};
await signIn();

/** The token that was emailed, recovered from its hash for the test only. */
async function tokenFor(newEmail) {
  // The service stores only a hash, so the plaintext cannot be read back. The
  // test therefore mints its own and writes the matching hash — the same thing
  // the email would have delivered.
  const plain = crypto.randomBytes(32).toString('hex');
  await db.query(
    `UPDATE boost_email_changes SET token_hash = $2
     WHERE customer_id = $1 AND new_email = $3 AND used_at IS NULL AND canceled_at IS NULL`,
    [CID, crypto.createHash('sha256').update(plain).digest('hex'), newEmail]
  );
  return plain;
}

out.push('--- A live session is not enough');

let r = await call('POST', '/me/email', { newEmail: MOVED_EMAIL, currentPassword: 'not-my-password' });
check('the wrong password is refused', r.status === 403 && r.body.code === 'invalid_password', JSON.stringify(r.body));

let rows = await db.query('SELECT count(*)::int n FROM boost_email_changes WHERE customer_id=$1', [CID]);
check('and nothing is recorded', rows.rows[0].n === 0);

out.push('--- The address has to be usable');

r = await call('POST', '/me/email', { newEmail: 'not-an-address', currentPassword: PASSWORD });
check('a malformed address is refused', r.status === 422 && r.body.code === 'invalid_email');

r = await call('POST', '/me/email', { newEmail: ORIGINAL_EMAIL, currentPassword: PASSWORD });
check('the address they already have is refused', r.status === 422 && r.body.code === 'same_email');

r = await call('POST', '/me/email', { newEmail: '  ' + MOVED_EMAIL.toUpperCase() + ' ', currentPassword: PASSWORD });
check('case and whitespace are normalised', r.status === 200 && r.body.pendingEmail.newEmail === MOVED_EMAIL, JSON.stringify(r.body.pendingEmail));

out.push('--- Nothing moves until the new address confirms');

const stillOld = await db.query('SELECT email FROM customers WHERE id=$1', [CID]);
check('THE ACCOUNT STILL HAS THE OLD ADDRESS', stillOld.rows[0].email === ORIGINAL_EMAIL, stillOld.rows[0].email);

r = await call('GET', '/me');
check('/me reports the change as pending', r.body.pendingEmail?.newEmail === MOVED_EMAIL, JSON.stringify(r.body.pendingEmail));
check('and still shows the current address', r.body.user.email === ORIGINAL_EMAIL);

r = await call('POST', '/auth/login', { email: MOVED_EMAIL, password: PASSWORD });
check('the new address cannot sign in yet', r.status === 401, String(r.status));

out.push('--- Only the newest link works');

const stale = await tokenFor(MOVED_EMAIL);
await signIn();
r = await call('POST', '/me/email', { newEmail: 'third.address@example.com', currentPassword: PASSWORD });
check('a second request supersedes the first', r.status === 200);

r = await call('POST', '/auth/confirm-email', { token: stale });
check('THE SUPERSEDED LINK IS DEAD', r.status === 400 && r.body.code === 'invalid_token', JSON.stringify(r.body));

const untouched = await db.query('SELECT email FROM customers WHERE id=$1', [CID]);
check('and the account is untouched', untouched.rows[0].email === ORIGINAL_EMAIL);

out.push('--- Cancelling');

r = await call('DELETE', '/me/email');
check('a pending change can be cancelled', r.status === 200);
r = await call('GET', '/me');
check('and /me stops reporting one', r.body.pendingEmail === null, JSON.stringify(r.body.pendingEmail));

out.push('--- Confirming');

await signIn();
r = await call('POST', '/me/email', { newEmail: MOVED_EMAIL, currentPassword: PASSWORD });
check('a fresh request is accepted', r.status === 200);

const good = await tokenFor(MOVED_EMAIL);

r = await call('POST', '/auth/confirm-email', { token: 'made-up-token' });
check('a bogus token is refused', r.status === 400 && r.body.code === 'invalid_token');

// Confirmed with no session at all, the way the link is really opened.
const saved = token;
token = null;
r = await call('POST', '/auth/confirm-email', { token: good });
check('CONFIRMED WITHOUT BEING SIGNED IN', r.status === 200 && r.body.email === MOVED_EMAIL, JSON.stringify(r.body));

const moved = await db.query('SELECT email FROM customers WHERE id=$1', [CID]);
check('the account has moved', moved.rows[0].email === MOVED_EMAIL, moved.rows[0].email);

/**
 * Following the same link twice reports success rather than an error.
 *
 * A refresh, the back button or a double click all replay it, and telling
 * someone their change failed when it already worked is the worse error. The
 * token is still spent — this is about what the member is told.
 */
r = await call('POST', '/auth/confirm-email', { token: good });
check('REPLAYING THE LINK IS NOT AN ERROR', r.status === 200 && r.body.email === MOVED_EMAIL, JSON.stringify(r.body));

const spentTwice = await db.query(
  'SELECT count(*)::int n FROM boost_email_changes WHERE token_hash IS NOT NULL AND used_at IS NOT NULL AND customer_id=$1', [CID]);
check('and does not create a second change', spentTwice.rows[0].n === 1, String(spentTwice.rows[0].n));

r = await call('POST', '/auth/login', { email: MOVED_EMAIL, password: PASSWORD });
check('the new address signs in', r.status === 200 && Boolean(r.body.token));
token = r.body.token;

r = await call('POST', '/auth/login', { email: ORIGINAL_EMAIL, password: PASSWORD });
check('the old address no longer does', r.status === 401);

token = saved;
r = await call('GET', '/me');
check('the session held through the change still works', r.status === 200 && r.body.user.email === MOVED_EMAIL, JSON.stringify(r.body?.user?.email));

const history = await db.query(
  'SELECT old_email, new_email, used_at FROM boost_email_changes WHERE customer_id=$1 AND used_at IS NOT NULL', [CID]);
check('the change is recorded with both addresses',
  history.rows.length === 1 && history.rows[0].old_email === ORIGINAL_EMAIL && history.rows[0].new_email === MOVED_EMAIL,
  JSON.stringify(history.rows));

// The narrow part of that rule: once the account has moved somewhere else, an
// older spent token must go back to failing rather than claim success for an
// address the member no longer has.
out.push('--- A spent link stops working once the address moves on');

await signIn(MOVED_EMAIL);
const THIRD = 'boost.tester.third@example.com';
await db.query('DELETE FROM customers WHERE email=$1', [THIRD]);
await call('POST', '/me/email', { newEmail: THIRD, currentPassword: PASSWORD });
const thirdToken = await tokenFor(THIRD);
r = await call('POST', '/auth/confirm-email', { token: thirdToken });
check('the account moves on again', r.status === 200 && r.body.email === THIRD, JSON.stringify(r.body));

r = await call('POST', '/auth/confirm-email', { token: good });
check('THE OLDER SPENT LINK NOW FAILS', r.status === 400 && r.body.code === 'invalid_token', JSON.stringify(r.body));

// Put them back on the moved address for the rest of the suite.
await db.query('UPDATE customers SET email=$1 WHERE id=$2', [MOVED_EMAIL, CID]);
await signIn(MOVED_EMAIL);

out.push('--- An address someone else owns');

// A second account holding the address this member wants.
const OTHER = 'someone.else@example.com';
await db.query('DELETE FROM customers WHERE email=$1', [OTHER]);
const otherId = (await db.query(
  `INSERT INTO customers (email, password_hash, password_set_at, email_verified, status, created_at, updated_at)
   VALUES ($1,'x',now(),true,'active',now(),now()) RETURNING id`, [OTHER])).rows[0].id;

await signIn(MOVED_EMAIL);
r = await call('POST', '/me/email', { newEmail: OTHER, currentPassword: PASSWORD });
check('the request looks identical — no membership oracle', r.status === 200, JSON.stringify(r.body));

const taken = await tokenFor(OTHER);
r = await call('POST', '/auth/confirm-email', { token: taken });
check('but confirming is refused', r.status === 409 && r.body.code === 'email_taken', JSON.stringify(r.body));

const unchanged = await db.query('SELECT email FROM customers WHERE id=$1', [CID]);
check('and the account keeps its address', unchanged.rows[0].email === MOVED_EMAIL);

out.push('--- Expiry');

await signIn(MOVED_EMAIL);
await call('POST', '/me/email', { newEmail: ORIGINAL_EMAIL, currentPassword: PASSWORD });
const expiring = await tokenFor(ORIGINAL_EMAIL);
await db.query(
  `UPDATE boost_email_changes SET expires_at = now() - interval '1 minute'
   WHERE customer_id=$1 AND used_at IS NULL AND canceled_at IS NULL`, [CID]);

r = await call('POST', '/auth/confirm-email', { token: expiring });
check('an expired link is refused', r.status === 400 && r.body.code === 'invalid_token');
r = await call('GET', '/me');
check('and /me no longer calls it pending', r.body.pendingEmail === null);

/* ── put the member back ──────────────────────────────────────────────────── */

await db.query('DELETE FROM customers WHERE id=$1', [otherId]);
await db.query('UPDATE customers SET email=$1 WHERE id=$2', [ORIGINAL_EMAIL, CID]);
await db.query('DELETE FROM boost_email_changes WHERE customer_id=$1', [CID]);

const restored = await db.query('SELECT email FROM customers WHERE id=$1', [CID]);
check('the member is restored for the other suites', restored.rows[0].email === ORIGINAL_EMAIL, restored.rows[0].email);

console.log('\n' + out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
await db.end();
process.exit(fail ? 1 : 0);
