import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database.config.js';
import { BoostProfile, DEFAULT_NOTIFICATIONS } from '../entities/BoostProfile.entity.js';
import { BoostResponse, BoostError } from '../utils/boost-response.util.js';
import { isValidTimezone } from '../utils/boost-date.util.js';
import { loadMember, toUserDto } from '../services/boost-profile.service.js';
import {
  cancelSubscription,
  createBillingPortalSession,
  findSubscription,
  resumeSubscription,
  toSubscriptionDto
} from '../services/boost-subscription.service.js';
import { memberSnapshot } from '../services/boost-stats.service.js';
import { changePassword } from '../services/boost-auth.service.js';
import {
  cancelEmailChange,
  confirmEmailChange,
  pendingChangeFor,
  requestEmailChange
} from '../services/boost-email-change.service.js';
import { logger } from '../utils/logger.util.js';

/** The member's own account: profile, preferences and membership. */
export class BoostAccountController {
  /**
   * GET /me
   *
   * One call on every page load, carrying the three things the shell needs:
   * who they are, whether they can train, and the counters in the nav.
   */
  static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { customer, profile } = await loadMember(req.member!.customerId);

      const [subscription, snapshot, pendingEmail] = await Promise.all([
        findSubscription(customer.id),
        memberSnapshot(profile),
        pendingChangeFor(customer.id)
      ]);

      BoostResponse.ok(res, {
        user: toUserDto(customer, profile),
        subscription: await toSubscriptionDto(customer.id, subscription),
        stats: snapshot.stats,
        // Non-null while an address change is waiting to be confirmed, so the
        // profile screen can say so rather than showing the old address as if
        // nothing were happening.
        pendingEmail
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /me
   *
   * Accepts any subset of the editable fields. Deliberately narrow: the email
   * address is the account's identity and the link back to the funnel purchase,
   * so it is not editable here, and neither is anything that would change what
   * the member is entitled to.
   */
  static async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { customer, profile } = await loadMember(req.member!.customerId);
      const body = req.body ?? {};

      if (typeof body.displayName === 'string') {
        const name = body.displayName.trim().slice(0, 100);
        if (!name) {
          throw new BoostError(422, 'invalid_display_name', 'Your display name cannot be empty.');
        }
        profile.display_name = name;
      }

      if (typeof body.name === 'string') {
        profile.full_name = body.name.trim().slice(0, 255) || null;
      }

      if (body.birthYear !== undefined) {
        const year = Number(body.birthYear);
        const thisYear = new Date().getUTCFullYear();
        if (body.birthYear === null || body.birthYear === '') {
          profile.birth_year = null;
        } else if (!Number.isInteger(year) || year < thisYear - 120 || year > thisYear - 5) {
          throw new BoostError(422, 'invalid_birth_year', 'Please enter a valid year of birth.');
        } else {
          profile.birth_year = year;
        }
      }

      if (typeof body.region === 'string') {
        profile.region = body.region.trim().slice(0, 100) || null;
      }

      if (typeof body.locale === 'string' && ['en', 'ja'].includes(body.locale)) {
        profile.locale = body.locale;
      }

      // Changing this moves when the member's day rolls over, so it is validated
      // rather than trusted — an unknown zone would silently fall back and leave
      // them wondering why the quiz resets at the wrong time.
      if (typeof body.timezone === 'string' && body.timezone.trim()) {
        if (!isValidTimezone(body.timezone.trim())) {
          throw new BoostError(422, 'invalid_timezone', 'That time zone is not recognised.');
        }
        profile.timezone = body.timezone.trim();
      }

      if (body.notifications && typeof body.notifications === 'object') {
        const merged = { ...DEFAULT_NOTIFICATIONS, ...(profile.notifications ?? {}) };
        for (const key of Object.keys(DEFAULT_NOTIFICATIONS) as (keyof typeof DEFAULT_NOTIFICATIONS)[]) {
          const value = body.notifications[key];
          if (typeof value === 'boolean') merged[key] = value;
        }
        profile.notifications = merged;
      }

      await AppDataSource.getRepository(BoostProfile).save(profile);

      BoostResponse.ok(res, { user: toUserDto(customer, profile) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /me/password
   *
   * Changes the password of a signed-in member. Requires the current one, and
   * returns a fresh token so the session doing the changing survives while
   * every other device is signed out.
   */
  static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword, remember } = req.body ?? {};

      const result = await changePassword(
        req.member!.customerId,
        currentPassword,
        newPassword,
        remember !== false
      );

      BoostResponse.ok(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /me/email
   *
   * Starts an address change. Requires the current password, and changes
   * nothing until the new address confirms — see the service for why each of
   * those matters.
   */
  static async requestEmailChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { newEmail, currentPassword } = req.body ?? {};

      const pending = await requestEmailChange(
        req.member!.customerId,
        newEmail,
        currentPassword,
        req.ip ?? null
      );

      BoostResponse.ok(res, {
        pendingEmail: pending,
        message: `Check ${pending.newEmail} for a confirmation link. Your address will not change until you follow it.`
      });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /me/email — drops a pending change the member no longer wants. */
  static async cancelEmailChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await cancelEmailChange(req.member!.customerId);
      BoostResponse.ok(res, { ok: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/confirm-email
   *
   * Public. The link is opened wherever the new address is read — often a
   * different browser, often signed out — so the token is the credential.
   */
  static async confirmEmailChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await confirmEmailChange(req.body?.token);
      BoostResponse.ok(res, { ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /me/deletion-request
   *
   * Records that the member wants their account erased. Deliberately does not
   * delete anything: the account is tied to a live subscription, payment
   * records that have to be kept for tax, and a certificate the member bought.
   * Untangling that is a decision for a person, not a button.
   *
   * The member gets an immediate, honest acknowledgement rather than a screen
   * that appears to have done something it has not.
   */
  static async requestDeletion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { customer, profile } = await loadMember(req.member!.customerId);

      logger.warn(
        `ACCOUNT DELETION REQUESTED — customer ${customer.id} (${customer.email}, member ${profile.member_id}). ` +
          'Check for an active subscription before actioning.'
      );

      BoostResponse.ok(res, {
        ok: true,
        message:
          'Your request has been logged. Support will email you within two working days to confirm before anything is erased.'
      });
    } catch (error) {
      next(error);
    }
  }

  /** GET /subscription */
  static async subscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.member!.customerId;
      const subscription = await findSubscription(customerId);

      if (!subscription) {
        throw new BoostError(404, 'no_subscription', 'No subscription found for this account.');
      }

      BoostResponse.ok(res, { subscription: await toSubscriptionDto(customerId, subscription) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /subscription/cancel
   *
   * Stops the renewal; it does not end the membership on the spot. The member
   * keeps full access until the period they have already paid for runs out,
   * which is why the response still reports `status: "active"` with
   * `cancelAtPeriodEnd: true`.
   */
  static async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.member!.customerId;
      const updated = await cancelSubscription(customerId);

      BoostResponse.ok(res, { subscription: await toSubscriptionDto(customerId, updated) });
    } catch (error) {
      next(error);
    }
  }

  /** POST /subscription/resume — un-cancel, while still inside the paid period. */
  static async resume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.member!.customerId;
      const updated = await resumeSubscription(customerId);

      BoostResponse.ok(res, { subscription: await toSubscriptionDto(customerId, updated) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /subscription/billing-portal
   *
   * Returns a one-time Stripe-hosted URL for changing the card. Card details
   * never pass through this service or the members' bundle, so there is no PCI
   * surface here at all.
   */
  static async billingPortal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const url = await createBillingPortalSession(req.member!.customerId);
      BoostResponse.ok(res, { url });
    } catch (error) {
      next(error);
    }
  }
}
