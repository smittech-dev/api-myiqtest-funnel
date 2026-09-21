import { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limits for the members' area.
 *
 * Three endpoints need them for different reasons: login is guessable, forgot
 * password sends mail to an address someone else chose, and starting an attempt
 * writes a row that spends the member's day.
 *
 * Counted per IP *and* per email where there is one, because either alone is
 * trivially worked around: one address from a botnet, or a whole dictionary of
 * addresses from one machine.
 *
 * In-process counters, so each instance limits independently. At one or two
 * instances that is the same thing; behind a wider fleet these want a shared
 * store, which express-rate-limit takes as a drop-in option.
 */

/** IPv6 addresses are handed out a /64 at a time, so the raw address is not an identity. */
const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? '');

const emailOf = (req: Request): string =>
  String((req.body as { email?: unknown } | undefined)?.email ?? '')
    .trim()
    .toLowerCase();

/** The shape the members' app understands — any other body would render as a blank error. */
const boostLimitResponse = (code: string, message: string) => (_req: Request, res: Response) => {
  res.status(429).json({ code, message });
};

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  // The app sets `trust proxy` in production because it sits behind a
  // TLS-terminating proxy. express-rate-limit flags that as permissive; it is
  // correct for our topology, and the check would otherwise log on every call.
  validate: { trustProxy: false as const }
};

/**
 * Login: 10 attempts per 15 minutes.
 *
 * Deliberately not stingy. The welcome-email password is `K7MP-3QRT-9XYZ` —
 * fourteen characters typed by hand from an email, often from a phone to a
 * laptop. Real members mistype it, and locking them out of the product they
 * just bought is a worse failure than a slow brute force against 59 bits of
 * entropy.
 */
export const boostLoginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKey(req)}|${emailOf(req)}`,
  handler: boostLimitResponse(
    'too_many_attempts',
    'Too many sign-in attempts. Please wait 15 minutes and try again.'
  )
});

/**
 * Forgot password: 5 per hour.
 *
 * This endpoint sends mail to an address the caller typed, so it is a way to
 * post someone else's inbox. The limiter is the only thing between it and being
 * used as one.
 */
export const boostForgotPasswordLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `${ipKey(req)}|${emailOf(req)}`,
  handler: boostLimitResponse(
    'too_many_requests',
    'Too many reset requests. Please wait an hour and try again.'
  )
});

/** Reset: 10 per hour per IP. Guessing a 256-bit token is not the threat; hammering is. */
export const boostResetPasswordLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: ipKey,
  handler: boostLimitResponse(
    'too_many_requests',
    'Too many attempts. Please request a new reset link.'
  )
});

/**
 * Starting attempts: 20 per hour per member.
 *
 * The daily limit already caps the scored quiz at one a day; this is about
 * practice runs, which are unlimited by design and each of which builds twenty
 * questions.
 */
export const boostAttemptLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => (req as Request & { member?: { customerId: string } }).member?.customerId ?? ipKey(req),
  handler: boostLimitResponse('too_many_requests', 'You are starting quizzes very quickly. Please wait a moment.')
});

/**
 * Game scores: 60 per hour per member.
 *
 * The shortest games run 45 seconds, so sixty finished runs in an hour is
 * already beyond continuous play. This is not the defence against a forged
 * score — bounds in `boost-games.service.ts` handle the absurd case, and a
 * client that runs the game can always report what it likes — it is what stops
 * a script posting thousands of plausible ones.
 */
export const boostScoreLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => (req as Request & { member?: { customerId: string } }).member?.customerId ?? ipKey(req),
  handler: boostLimitResponse(
    'too_many_requests',
    'That is a lot of games in one hour. Take a break and come back shortly.'
  )
});

/**
 * Changing a password: 10 attempts an hour.
 *
 * The endpoint takes the *current* password, so without a limit an unattended
 * session becomes a way to guess it offline-fast. Ten an hour leaves room for
 * someone genuinely mistyping their own.
 */
export const boostChangePasswordLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => (req as Request & { member?: { customerId: string } }).member?.customerId ?? ipKey(req),
  handler: boostLimitResponse(
    'too_many_attempts',
    'Too many attempts. Please wait an hour and try again.'
  )
});

/**
 * Email changes: 10 an hour.
 *
 * Each request sends mail to an address the caller typed, so without a limit
 * this is a way to post someone else's inbox — and it also takes the current
 * password, so it is a guessing surface too.
 *
 * Ten rather than five because mistyping the address you are moving to is the
 * single most likely thing to go wrong here, and the correction costs a
 * request. The caller must already be signed in and know the password, so the
 * ceiling is about nuisance rather than compromise.
 */
export const boostEmailChangeLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => (req as Request & { member?: { customerId: string } }).member?.customerId ?? ipKey(req),
  handler: boostLimitResponse(
    'too_many_requests',
    'Too many attempts. Please wait an hour and try again.'
  )
});

/** Confirming: 10 an hour per IP. Guessing a 256-bit token is not the threat; hammering is. */
export const boostConfirmEmailLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: ipKey,
  handler: boostLimitResponse('too_many_requests', 'Too many attempts. Please request a new link.')
});
