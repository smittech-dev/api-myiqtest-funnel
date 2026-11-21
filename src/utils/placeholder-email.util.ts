/**
 * The address a customer carries before we know their real one.
 *
 * The funnel no longer asks for an email before checkout. The quiz is submitted
 * without one, and the address arrives later: typed beside the card form for a
 * card payment, or on the Personal Detail page — with the wallet's own address
 * as a fallback — for Apple Pay and Google Pay.
 *
 * Until then every customer needs *some* address: `customers.email` is unique
 * and not null, Stripe wants one on the Customer it bills, and the quiz row
 * mirrors it. This is that address. It is built from the quiz's own database
 * id, so it is unique without a lookup and says at a glance which attempt it
 * belongs to.
 *
 * The raw numeric id rather than the encrypted `quiz_id` token: the address
 * never appears in a URL, and the encryption exists to stop URLs being
 * enumerated, not to hide ids from the database that issued them.
 *
 * Nothing is ever sent to one of these. `emailService.send` refuses them, so a
 * code path that forgets to check cannot mail the company's own domain.
 */

const DOMAIN = 'noumirai.com';

/** `dummy_{quizResultId}@noumirai.com` */
export function placeholderEmailFor(quizResultId: string | number): string {
  return `dummy_${quizResultId}@${DOMAIN}`;
}

const PATTERN = new RegExp(`^dummy_\\d+@${DOMAIN.replace('.', '\\.')}$`, 'i');

/** True for an address minted by `placeholderEmailFor`, and only for those. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && PATTERN.test(email.trim());
}

/**
 * The form every real address is stored in.
 *
 * Lower-cased and trimmed so the uniqueness of `customers.email` means one
 * person rather than one spelling — `Taro@Example.com` and `taro@example.com`
 * are the same inbox, and treating them as two customers would split one
 * person's purchases across two accounts.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
