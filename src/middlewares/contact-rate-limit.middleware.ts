import { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ResponseUtil } from '../utils/api-response.util.js';

/**
 * The contact form: 5 submissions an hour per IP.
 *
 * This endpoint is public, unauthenticated, and every call both writes a row
 * and sends us an email — so without a ceiling it is a way to fill our own
 * inbox and our own table from one machine. Five an hour is well above anything
 * a real person does with a contact form and well below anything worth
 * scripting.
 *
 * In-process counters, like the members' area limiters: at one or two instances
 * that is the same thing, and express-rate-limit takes a shared store as a
 * drop-in option if the fleet ever widens.
 */
export const contactLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  // `trust proxy` is set in production because the app sits behind a
  // TLS-terminating proxy; the library flags that as permissive and would
  // otherwise log on every call.
  validate: { trustProxy: false },
  windowMs: 60 * 60 * 1000,
  limit: 5,
  /** IPv6 is handed out a /64 at a time, so the raw address is not an identity. */
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  handler: (_req: Request, res: Response) => {
    ResponseUtil.error(
      res,
      'You have sent several messages already. Please wait an hour before sending another.',
      429
    );
  }
});
