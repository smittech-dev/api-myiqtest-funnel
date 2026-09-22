import crypto from 'crypto';
import { IsNull } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { stripe } from '../config/stripe.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { BoostEmailChange } from '../entities/BoostEmailChange.entity.js';
import { PasswordUtil } from '../utils/password.util.js';
import { BoostError } from '../utils/boost-response.util.js';
import { logger } from '../utils/logger.util.js';
import { emailService } from './email.service.js';
import { createEmailContext, honorific } from '../emails/context.js';
import type { EmailLanguage } from '../emails/email.types.js';

/**
 * Changing the address a member signs in with.
 *
 * The rules this follows, and why each one is there:
 *
 *   1. **Re-authenticate.** The current password is required. A live session is
 *      not proof of identity — an unattended laptop would otherwise be enough to
 *      move someone's account to an attacker's address.
 *   2. **Verify the new address before switching.** Nothing on `customers`
 *      moves until the link is followed. A typo would otherwise lock a paying
 *      member out of the account they bought, with no way back in.
 *   3. **Tell the old address.** It is the only party who can say the change was
 *      not theirs. Without this a takeover is silent until they cannot sign in.
 *   4. **One live request at a time.** A new request supersedes the old, so two
 *      valid links can never point at two different addresses.
 *   5. **Single-use, expiring, hashed at rest.** Same handling as a password
 *      reset, because the link is worth the same to an attacker.
 *   6. **Never confirm whether an address is already registered.** The response
 *      is identical either way; the mismatch surfaces when the link is followed.
 */

const changeRepo = () => AppDataSource.getRepository(BoostEmailChange);
const customerRepo = () => AppDataSource.getRepository(Customer);

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

const normalise = (email: unknown): string => String(email ?? '').trim().toLowerCase();

/**
 * Deliberately permissive.
 *
 * The real test of an address is whether the confirmation email arrives, and
 * this flow is built around that. A stricter pattern here would only reject
 * valid-but-unusual addresses that would have worked.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/** How long a confirmation link stays good. */
const TTL_MINUTES = config.boost.passwordResetTtlMinutes;

export interface PendingEmailChange {
  newEmail: string;
  requestedAt: number;
  expiresAt: number;
}

/** The change in flight for this member, if there is one and it is still valid. */
export async function pendingChangeFor(customerId: string): Promise<PendingEmailChange | null> {
  const row = await changeRepo().findOne({
    where: { customer_id: customerId, used_at: IsNull(), canceled_at: IsNull() },
    order: { created_at: 'DESC' }
  });

  if (!row || row.expires_at.getTime() <= Date.now()) return null;

  return {
    newEmail: row.new_email,
    requestedAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime()
  };
}

/** The language this customer was sold in, for the two emails. */
async function languageFor(customerId: string): Promise<{ language: EmailLanguage; firstName: string | null }> {
  const quizResult = await AppDataSource.getRepository(CustomerQuizResult).findOne({
    where: { customer_id: customerId },
    order: { created_at: 'DESC' }
  });

  return {
    language: quizResult?.language?.toLowerCase() === 'en' ? 'en' : 'ja',
    firstName: quizResult?.first_name ?? null
  };
}

/**
 * Starts a change. Sends the confirmation to the new address and a notice to
 * the old one.
 */
export async function requestEmailChange(
  customerId: string,
  rawNewEmail: unknown,
  rawPassword: unknown,
  ip: string | null
): Promise<PendingEmailChange> {
  const customer = await customerRepo().findOne({ where: { id: customerId } });

  if (!customer?.password_set_at) {
    throw new BoostError(401, 'unauthenticated', 'You need to sign in.');
  }

  const password = String(rawPassword ?? '').trim();
  if (!(await PasswordUtil.compare(password, customer.password_hash ?? ''))) {
    throw new BoostError(403, 'invalid_password', 'That is not your current password.');
  }

  const newEmail = normalise(rawNewEmail);

  if (!LOOKS_LIKE_EMAIL.test(newEmail) || newEmail.length > 255) {
    throw new BoostError(422, 'invalid_email', 'That does not look like an email address.');
  }

  if (newEmail === customer.email.toLowerCase()) {
    throw new BoostError(422, 'same_email', 'That is already the address on your account.');
  }

  /**
   * Whether the address belongs to someone else is checked here *and* again
   * when the link is followed — but the answer is never returned. Saying "that
   * address is taken" turns this endpoint into a way to test which addresses
   * have accounts, and the member requesting it may not own the address they
   * are asking about.
   */
  const taken = await customerRepo()
    .createQueryBuilder('c')
    .where('LOWER(c.email) = :email', { email: newEmail })
    .andWhere('c.id != :id', { id: customerId })
    .getOne();

  const now = new Date();

  // One live request at a time — a new one supersedes whatever was pending.
  await changeRepo().update(
    { customer_id: customerId, used_at: IsNull(), canceled_at: IsNull() },
    { canceled_at: now }
  );

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);

  const row = await changeRepo().save(
    changeRepo().create({
      customer_id: customerId,
      new_email: newEmail,
      old_email: customer.email,
      token_hash: sha256(token),
      expires_at: expiresAt,
      requested_ip: ip
    })
  );

  if (taken) {
    // The row exists so the flow looks identical from outside, but no email is
    // sent to an address that already belongs to someone else — that would be
    // using one customer's inbox to tell another that they have an account.
    logger.warn(
      `Email change requested by customer ${customerId} for an address already in use — no mail sent.`
    );
    return { newEmail, requestedAt: row.created_at.getTime(), expiresAt: expiresAt.getTime() };
  }

  const { language, firstName } = await languageFor(customerId);
  const confirmUrl = `${config.boost.appUrl.replace(/\/+$/, '')}/confirm-email?token=${token}`;

  const base = (recipient: string) =>
    createEmailContext(
      { email: recipient, language, site_url: config.funnelUrl },
      {
        first_name: firstName,
        honorific_name: honorific(language, firstName),
        new_email: newEmail,
        old_email: customer.email,
        program_name: config.brainTraining.name[language]
      }
    );

  // The confirmation, to the new address only.
  await emailService
    .send({
      templateId: 'transactional_email_change_confirm',
      to: newEmail,
      toName: firstName,
      context: {
        ...base(newEmail),
        confirm_url: confirmUrl,
        confirm_expires_hours: Math.max(1, Math.round(TTL_MINUTES / 60))
      }
    })
    .catch((error) => logger.error(`Email change confirmation failed: ${error?.message ?? error}`));

  // The warning, to the old address. Sent even when the confirmation fails —
  // this is the one the real owner needs.
  await emailService
    .send({
      templateId: 'transactional_email_change_notice',
      to: customer.email,
      toName: firstName,
      context: base(customer.email)
    })
    .catch((error) => logger.error(`Email change notice failed: ${error?.message ?? error}`));

  logger.info(`Email change requested for customer ${customerId}.`);

  return { newEmail, requestedAt: row.created_at.getTime(), expiresAt: expiresAt.getTime() };
}

/**
 * Completes a change from the link in the confirmation email.
 *
 * Public: the link may well be opened in the browser where nobody is signed in,
 * or on the phone the new address is read on. The token is the credential.
 */
export async function confirmEmailChange(rawToken: unknown): Promise<{ email: string }> {
  const token = String(rawToken ?? '').trim();

  const invalid = () =>
    new BoostError(400, 'invalid_token', 'This link is invalid or has expired.');

  if (!token) throw invalid();

  const row = await changeRepo().findOne({ where: { token_hash: sha256(token) } });

  if (!row || row.canceled_at) throw invalid();

  const customer = await customerRepo().findOne({ where: { id: row.customer_id } });
  if (!customer) throw invalid();

  /**
   * Following the same link twice reports success, not failure.
   *
   * The token is single use, so the second call has nothing left to do — but
   * telling someone their change failed when it already worked is the worse of
   * the two errors, and it is easy to reach: a page refresh, the back button, a
   * double click, or a client that fires the request twice.
   *
   * The check is deliberately narrow. It succeeds only when the account is
   * *currently* on the address this token was for; a token spent before some
   * later change still fails, because claiming success for an address the
   * member no longer has would be a lie.
   */
  if (row.used_at) {
    if (customer.email.toLowerCase() === row.new_email.toLowerCase()) {
      return { email: customer.email };
    }
    throw invalid();
  }

  if (row.expires_at.getTime() <= Date.now()) throw invalid();

  // Re-checked at the moment it would take effect: the address may have been
  // claimed in the time between the request and the click.
  const taken = await customerRepo()
    .createQueryBuilder('c')
    .where('LOWER(c.email) = :email', { email: row.new_email })
    .andWhere('c.id != :id', { id: row.customer_id })
    .getOne();

  if (taken) {
    row.canceled_at = new Date();
    await changeRepo().save(row);
    throw new BoostError(
      409,
      'email_taken',
      'That address is already in use on another account. Please choose a different one.'
    );
  }

  customer.email = row.new_email;
  await customerRepo().save(customer);

  row.used_at = new Date();
  await changeRepo().save(row);

  await syncStripeEmail(row.customer_id, row.new_email);

  logger.info(`Email changed for customer ${row.customer_id} (${row.old_email} -> ${row.new_email}).`);

  return { email: row.new_email };
}

/** Drops a pending change. Used when the member changes their mind. */
export async function cancelEmailChange(customerId: string): Promise<void> {
  await changeRepo().update(
    { customer_id: customerId, used_at: IsNull(), canceled_at: IsNull() },
    { canceled_at: new Date() }
  );
}

/**
 * Keeps Stripe in step, so receipts and card emails go to the new address.
 *
 * Best-effort: the change has already happened locally, and failing the request
 * now would tell the member it did not work when it did.
 */
async function syncStripeEmail(customerId: string, email: string): Promise<void> {
  try {
    const subscription = await AppDataSource.getRepository(CustomerSubscription).findOne({
      where: { customer_id: customerId },
      order: { created_at: 'DESC' }
    });

    if (!subscription?.stripe_customer_id) return;

    await stripe.customers.update(subscription.stripe_customer_id, { email });
  } catch (error: any) {
    logger.warn(
      `Email changed locally for customer ${customerId} but Stripe was not updated: ${error?.message ?? error}`
    );
  }
}
