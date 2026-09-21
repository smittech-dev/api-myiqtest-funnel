import crypto from 'crypto';
import { LessThan, IsNull } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { BoostPasswordReset } from '../entities/BoostPasswordReset.entity.js';
import { BoostProfile } from '../entities/BoostProfile.entity.js';
import { PasswordUtil } from '../utils/password.util.js';
import { BoostJwtUtil } from '../utils/boost-jwt.util.js';
import { BoostError } from '../utils/boost-response.util.js';
import { logger } from '../utils/logger.util.js';
import { emailService } from './email.service.js';
import { createEmailContext, honorific } from '../emails/context.js';
import { ensureBoostProfile, toUserDto } from './boost-profile.service.js';
import type { EmailLanguage } from '../emails/email.types.js';
import type { UserDto } from '../types/boost.types.js';

/**
 * Sign-in for the brain training programme.
 *
 * There is no registration here and there never will be: an account exists
 * because the funnel sold a certificate and the welcome email issued a
 * password (see `email-transactional.service.ts`). This service authenticates
 * against that record and nothing else.
 */

/**
 * A bcrypt hash of a value nobody knows, compared against when the email is not
 * a customer's.
 *
 * Without it, a missing account returns in under a millisecond while a real one
 * takes the ~80ms bcrypt costs, and the difference tells an attacker which of
 * their addresses are customers — the exact thing the identical error message
 * is there to hide.
 */
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** One message for every failure mode, so the endpoint is not a membership oracle. */
const invalidCredentials = () =>
  new BoostError(401, 'invalid_credentials', 'That email address or password is not correct.');

const normaliseEmail = (email: unknown): string => String(email ?? '').trim().toLowerCase();

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

async function findCustomerByEmail(email: string): Promise<Customer | null> {
  return AppDataSource.getRepository(Customer)
    .createQueryBuilder('c')
    .where('LOWER(c.email) = :email', { email })
    .getOne();
}

export interface LoginResult {
  token: string;
  user: UserDto;
}

/**
 * Verify credentials and open a session.
 *
 * `password` is trimmed but never lower-cased. The password the welcome email
 * delivers looks like `K7MP-3QRT-9XYZ` — uppercase and digits only — and
 * normalising its case would quietly let `k7mp-3qrt-9xyz` in too.
 */
export async function login(
  rawEmail: unknown,
  rawPassword: unknown,
  remember = true
): Promise<LoginResult> {
  const email = normaliseEmail(rawEmail);
  const password = String(rawPassword ?? '').trim();

  if (!email || !password) throw invalidCredentials();

  const customer = await findCustomerByEmail(email);

  // Someone who took the quiz but never bought has a `password_hash` — the
  // funnel seeds it with a throwaway sha256 at quiz submission — but no
  // `password_set_at`. That column is the only thing that marks a real
  // credential, and this is the check that keeps the platform closed to
  // everyone who has not paid.
  const usable = customer?.password_set_at ? customer : null;

  const matches = await PasswordUtil.compare(password, usable?.password_hash ?? DUMMY_HASH);

  if (!usable || !matches) throw invalidCredentials();

  // Created here rather than only by the welcome email, so every customer who
  // bought before this shipped gets a profile on their next sign-in.
  const profile = await ensureBoostProfile(usable);

  profile.last_seen_at = new Date();
  await AppDataSource.getRepository(BoostProfile).save(profile);

  return {
    token: BoostJwtUtil.sign(usable.id, usable.email, remember),
    user: toUserDto(usable, profile)
  };
}

/**
 * Start a password reset.
 *
 * Always resolves. The caller answers 200 whatever happened here, because
 * anything else — a different status, a different message, a different response
 * time — turns this endpoint into a way to test whether an address is a paying
 * customer.
 */
export async function requestPasswordReset(rawEmail: unknown, ip: string | null): Promise<void> {
  const email = normaliseEmail(rawEmail);
  if (!email) return;

  const customer = await findCustomerByEmail(email);

  // No account, or an account that never completed a purchase. A quiz-taker
  // must not be able to reset their way into the platform: there is no sign-up,
  // and this would be one.
  if (!customer || !customer.password_set_at) {
    logger.info(`Password reset requested for a non-member address — nothing sent.`);
    return;
  }

  const repo = AppDataSource.getRepository(BoostPasswordReset);
  const now = new Date();

  // One live link at a time. Without this, an older email still works, so
  // forwarding or leaking any previous message stays dangerous indefinitely.
  await repo.update({ customer_id: customer.id, used_at: IsNull() }, { used_at: now });

  const token = crypto.randomBytes(32).toString('hex');
  const ttlMinutes = config.boost.passwordResetTtlMinutes;

  await repo.save(
    repo.create({
      customer_id: customer.id,
      token_hash: sha256(token),
      expires_at: new Date(now.getTime() + ttlMinutes * 60 * 1000),
      used_at: null,
      requested_ip: ip
    })
  );

  const quizResult = await AppDataSource.getRepository(CustomerQuizResult).findOne({
    where: { customer_id: customer.id },
    order: { created_at: 'DESC' }
  });

  // The members' area is English-only, but the customer knows us from the
  // funnel — replying in the language they bought in is less jarring than
  // switching on them mid-relationship.
  const language: EmailLanguage = quizResult?.language?.toLowerCase() === 'en' ? 'en' : 'ja';
  const siteUrl = config.funnelUrl;
  const resetUrl = `${config.boost.appUrl.replace(/\/+$/, '')}/reset-password?token=${token}`;

  const context = createEmailContext(
    { email: customer.email, language, site_url: siteUrl },
    {
      first_name: quizResult?.first_name ?? null,
      honorific_name: honorific(language, quizResult?.first_name ?? null),
      iq_score: quizResult?.iq_score ?? null,
      reset_url: resetUrl,
      reset_expires_hours: Math.max(1, Math.round(ttlMinutes / 60)),
      program_name: config.brainTraining.name
    }
  );

  // Sent directly rather than through `emailTransactionalService`, whose guard
  // dedups permanently on a quiz result id. Correct for a welcome, wrong here:
  // a reset is user-initiated and deliberately repeatable, and has no quiz
  // result to key on. The throttle lives in the rate limiter and in the
  // one-live-token rule above.
  const result = await emailService.send({
    templateId: 'transactional_password_reset',
    to: customer.email,
    toName: quizResult?.first_name ?? null,
    context
  });

  if (result.status === 'failed') {
    // Still not surfaced to the caller: a mail failure must not become a way to
    // learn that the address was a member.
    logger.error(`Password reset email failed for customer ${customer.id}: ${result.error}`);
  }
}

/**
 * Finish a password reset.
 *
 * Writing `password_set_at` does double duty: it stores the change, and because
 * that column is the session epoch every token issued before this instant stops
 * verifying. That is what makes the promise on the reset screen — "signs you out
 * everywhere else, on every device" — true, with no sessions table.
 */
export async function resetPassword(rawToken: unknown, rawPassword: unknown): Promise<void> {
  const token = String(rawToken ?? '').trim();
  const password = String(rawPassword ?? '');

  const invalidToken = () =>
    new BoostError(400, 'invalid_token', 'This link is invalid or has expired.');

  if (!token) throw invalidToken();

  const repo = AppDataSource.getRepository(BoostPasswordReset);
  const record = await repo.findOne({ where: { token_hash: sha256(token) } });

  // Never used, not expired, and actually exists — all three failures read the
  // same to the caller.
  if (!record || record.used_at || record.expires_at.getTime() <= Date.now()) throw invalidToken();

  assertStrongPassword(password);

  const customerRepo = AppDataSource.getRepository(Customer);
  const customer = await customerRepo.findOne({ where: { id: record.customer_id } });
  if (!customer) throw invalidToken();

  customer.password_hash = await PasswordUtil.hash(password);
  customer.password_set_at = new Date();
  await customerRepo.save(customer);

  record.used_at = new Date();
  await repo.save(record);

  logger.info(`Password reset completed for customer ${customer.id}; all sessions invalidated.`);
}

/** Housekeeping: expired reset rows are of no further use. */
export async function purgeExpiredResetTokens(): Promise<number> {
  const result = await AppDataSource.getRepository(BoostPasswordReset).delete({
    expires_at: LessThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  });
  return result.affected ?? 0;
}

/**
 * Change the password of a member who is already signed in.
 *
 * Until now the only route was to sign out and use "forgot password", which
 * sends someone who is looking at their own profile out of the product to fetch
 * an email. Requiring the current password is what makes this safe to offer to
 * a live session: an unattended laptop should not be enough to lock the owner
 * out of their own account.
 *
 * Like a reset, this bumps `password_set_at`, so every other device is signed
 * out. The caller is handed a fresh token so the session they are using
 * survives — otherwise changing your password would sign you out of the page
 * you changed it on.
 */
export async function changePassword(
  customerId: string,
  rawCurrent: unknown,
  rawNext: unknown,
  remember = true
): Promise<{ token: string }> {
  const current = String(rawCurrent ?? '').trim();
  const next = String(rawNext ?? '');

  const repo = AppDataSource.getRepository(Customer);
  const customer = await repo.findOne({ where: { id: customerId } });

  if (!customer?.password_set_at) {
    throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
  }

  if (!(await PasswordUtil.compare(current, customer.password_hash ?? ''))) {
    throw new BoostError(403, 'invalid_password', 'That is not your current password.');
  }

  assertStrongPassword(next);

  if (current === next) {
    throw new BoostError(422, 'weak_password', 'Your new password must be different from the current one.');
  }

  customer.password_hash = await PasswordUtil.hash(next);
  customer.password_set_at = new Date();
  await repo.save(customer);

  logger.info(`Password changed from the profile screen for customer ${customer.id}.`);

  // Issued after the stamp, so this token is newer than the epoch it is
  // checked against and survives the sign-out it just triggered elsewhere.
  return { token: BoostJwtUtil.sign(customer.id, customer.email, remember) };
}

/**
 * The password rules, in one place.
 *
 * Mirrors what the reset screen shows the member, so the server never rejects
 * something the UI presented as acceptable.
 */
export function assertStrongPassword(password: string): void {
  if (password.length < 8) {
    throw new BoostError(422, 'weak_password', 'Passwords must be at least 8 characters.');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new BoostError(422, 'weak_password', 'Passwords must contain at least one letter and one number.');
  }
}
