import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { getTemplate } from '../emails/registry.js';
import type { EmailLanguage } from '../emails/email.types.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { logger } from '../utils/logger.util.js';

/**
 * Opting out of marketing email.
 *
 * ## Why the link carries no stored token
 *
 * An unsubscribe link is minted into every marketing send, and the same person
 * may hold five of them in five different messages. Issuing a stored,
 * single-use token per send would mean five rows per customer, four of which go
 * stale the moment one is used — and a customer who clicks the *oldest* email
 * in their inbox would be told their link had expired, which is precisely the
 * moment you must not fail.
 *
 * So the token is `EncryptionUtil.encryptId(customerId)`: deterministic, so
 * every email carries the same link and any of them works forever;
 * non-enumerable, so `?c=8421` cannot be walked to a stranger's address; and
 * tagged, so a forged token is rejected rather than landing on a real account.
 * Nothing is written at send time.
 *
 * ## Why this is not a bearer credential
 *
 * The token unsubscribes and nothing else. It is not a session, it reveals no
 * address, and the worst a leaked one can do is stop marketing email to an
 * account — which the owner can undo from the same page. That is the right
 * trade for a link that has to work from a phone, signed out, in one tap.
 */

const customers = () => AppDataSource.getRepository(Customer);

/** The token that identifies a customer in an unsubscribe link. */
export function unsubscribeTokenFor(customerId: string | number): string {
  return EncryptionUtil.encryptId(customerId);
}

/**
 * The full link for a customer, or null when we cannot build one.
 *
 * Null rather than a broken URL: a footer with no unsubscribe line is better
 * than one whose link 404s, and the caller renders the row only when this
 * returns something.
 */
export function unsubscribeUrlFor(
  customerId: string | number | null | undefined,
  language: EmailLanguage = 'en'
): string | null {
  if (customerId === null || customerId === undefined || customerId === '') return null;

  try {
    const base = config.appUrl.replace(/\/+$/, '');
    // The language rides on the link because the customer row does not carry
    // one — it lives on the quiz result. The email knows which side of the
    // funnel it is writing to, so it is the thing that can say.
    return (
      `${base}/email/unsubscribe?t=${encodeURIComponent(unsubscribeTokenFor(customerId))}` +
      `&lang=${language}`
    );
  } catch (error: any) {
    logger.warn(`Could not build an unsubscribe link for customer ${customerId}: ${error?.message}`);
    return null;
  }
}

/**
 * Whether a given template may carry an unsubscribe link.
 *
 * Read off the template's own `category` rather than kept as a second list,
 * because two lists drift: a new marketing template added to the registry is
 * covered here the moment it exists, and cannot be forgotten.
 */
export function templateIsOptOutable(templateId: string): boolean {
  return getTemplate(templateId)?.category === 'marketing';
}

/** The customer behind an unsubscribe token, or null when it does not open. */
export async function customerForToken(rawToken: unknown): Promise<Customer | null> {
  const token = String(rawToken ?? '').trim();
  if (!token) return null;

  const customerId = EncryptionUtil.tryDecryptId(token);
  if (!customerId) return null;

  return customers().findOne({ where: { id: customerId } });
}

export interface UnsubscribeOutcome {
  email: string;
  /** True when this call changed the flag; false when it was already set. */
  changed: boolean;
  unsubscribedAt: Date | null;
}

/**
 * Stops marketing email to a customer.
 *
 * Idempotent, and deliberately so. Mail clients prefetch links, people click
 * twice, and a second click must read as "you are unsubscribed" rather than as
 * an error — so a customer who is already opted out gets the same confirmation,
 * with `changed: false` for the caller that wants to know.
 */
export async function unsubscribeCustomer(
  customer: Customer,
  source = 'email_link'
): Promise<UnsubscribeOutcome> {
  if (customer.marketing_unsubscribed_at) {
    return {
      email: customer.email,
      changed: false,
      unsubscribedAt: customer.marketing_unsubscribed_at
    };
  }

  customer.marketing_unsubscribed_at = new Date();
  customer.marketing_unsubscribe_source = source.slice(0, 50);
  await customers().save(customer);

  logger.info(`Marketing unsubscribe: customer ${customer.id} (${customer.email}) via ${source}`);

  return {
    email: customer.email,
    changed: true,
    unsubscribedAt: customer.marketing_unsubscribed_at
  };
}

/**
 * Puts a customer back on the list.
 *
 * Offered on the confirmation page for the one case that actually happens: a
 * misclick, or someone unsubscribing from a shared inbox and wanting it back.
 * The same token opens it, because requiring a sign-in to undo a thing that
 * needed no sign-in to do is a trap.
 */
export async function resubscribeCustomer(customer: Customer): Promise<UnsubscribeOutcome> {
  if (!customer.marketing_unsubscribed_at) {
    return { email: customer.email, changed: false, unsubscribedAt: null };
  }

  customer.marketing_unsubscribed_at = null;
  customer.marketing_unsubscribe_source = null;
  await customers().save(customer);

  logger.info(`Marketing resubscribe: customer ${customer.id} (${customer.email})`);

  return { email: customer.email, changed: true, unsubscribedAt: null };
}

/**
 * Whether an address has opted out — the last check before a marketing send.
 *
 * By address rather than by id because that is what the transport has in hand,
 * and because the point of this check is to be the backstop for every path into
 * `emailService.send`, including ones that never loaded a customer row.
 */
export async function isUnsubscribed(email: string): Promise<boolean> {
  const address = String(email ?? '').trim().toLowerCase();
  if (!address) return false;

  const row = await customers()
    .createQueryBuilder('c')
    .select('c.marketing_unsubscribed_at', 'unsubscribed_at')
    .where('LOWER(c.email) = :address', { address })
    .getRawOne();

  return Boolean(row?.unsubscribed_at);
}
