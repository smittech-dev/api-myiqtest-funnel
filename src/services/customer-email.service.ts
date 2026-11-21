import crypto from 'crypto';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { stripe } from '../config/stripe.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { emailTransactionalService } from './email-transactional.service.js';
import { AppError } from '../utils/app-error.util.js';
import { logger } from '../utils/logger.util.js';
import {
  isPlaceholderEmail,
  normaliseEmail,
  placeholderEmailFor
} from '../utils/placeholder-email.util.js';

/**
 * Giving a quiz attempt its real email address.
 *
 * Every attempt starts on a placeholder (`dummy_{id}@noumirai.com`) because the
 * funnel no longer asks for an address before checkout. The real one arrives
 * from one of three places, and all three come through `assign`:
 *
 *   card_checkout    typed beside the card form, sent with the payment intent —
 *                    so for a card payment the address is in place before
 *                    anything is charged or subscribed
 *   personal_detail  typed on the Personal Detail page after a wallet payment
 *   wallet_fallback  the address Apple Pay / Google Pay handed over, applied by
 *                    the replacement job when nothing was typed in time
 *
 * ## One person, one customer
 *
 * `customers.email` is unique, and much of the system leans on "one customer
 * is one person": one subscription per customer, one members'-area login, one
 * Stripe Customer the cross-sale charges. So when the arriving address already
 * belongs to someone — a returning visitor — the attempt is *moved onto that
 * customer*, along with its payments and its subscription, and the placeholder
 * customer is retired. Matching is case-insensitive, because `Taro@` and
 * `taro@` are one inbox.
 *
 * ## The order of precedence
 *
 * The fallback only ever fills a gap: it applies the wallet's address to a
 * customer still on a placeholder, and does nothing once a real address is in
 * place. That is what makes "Personal Detail wins" true without the two having
 * to coordinate — whichever runs second sees the first one's work under the
 * row lock and acts on it.
 *
 * ## What happens at Stripe
 *
 * After the database commits: the Stripe Customer's email is updated, the
 * moved subscription's metadata follows, and — the case that would otherwise
 * cost a customer money — a trial subscription that turns out to duplicate a
 * plan the merged-into customer already holds is cancelled. The first sale
 * would never have opened that trial had it known who was paying; this
 * restores the outcome it would have reached.
 */

export type EmailSource = 'card_checkout' | 'personal_detail' | 'wallet_fallback';

export interface EmailAssignment {
  /** The quiz now carries the address it was given. */
  applied: boolean;
  /** It was moved onto a customer who already held that address. */
  merged: boolean;
  /** The customer the quiz belongs to afterwards. */
  customerId: string | null;
  /** Why nothing changed, when nothing did. */
  reason?: string;
}

const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired']);
const UNIQUE_VIOLATION = '23505';

/** What the database half decided, for the Stripe half to carry out. */
type Plan =
  | { kind: 'noop'; customerId: string | null; reason: string }
  | {
      kind: 'applied';
      quizResultId: string;
      customerId: string;
      email: string;
      merged: boolean;
      firstSalePaid: boolean;
      stripeCustomerId: string | null;
      /** Subscriptions that came across with this attempt. */
      movedSubscriptions: CustomerSubscription[];
      /** Of those, the ones duplicating a plan the target already held. */
      duplicateSubscriptions: CustomerSubscription[];
      /** The first-sale PaymentIntent, whose metadata names the address. */
      firstSaleIntentId: string | null;
    };

export class CustomerEmailService {
  /**
   * Give a quiz attempt this email address. Safe to call more than once and
   * from more than one process: the attempt's row is locked for the duration,
   * and a second call with the same address finds nothing to do.
   */
  async assign(
    quizResultId: string,
    rawEmail: string,
    source: EmailSource
  ): Promise<EmailAssignment> {
    const email = normaliseEmail(rawEmail);

    if (isPlaceholderEmail(email)) {
      throw new AppError('That email address cannot be used.', 400);
    }

    let plan: Plan;
    try {
      plan = await this.decide(quizResultId, email, source);
    } catch (err: any) {
      // Two attempts handed the same new address at the same instant both see
      // no owner — a lock cannot be taken on a row that does not exist yet —
      // and the second insert or rename hits the unique index. Run again: this
      // time the first one's customer is there, and the attempt merges into it.
      if (err?.code !== UNIQUE_VIOLATION) throw err;
      logger.warn(`Email assignment for quiz ${quizResultId} raced another — retrying once.`);
      plan = await this.decide(quizResultId, email, source);
    }

    if (plan.kind === 'noop') {
      return { applied: false, merged: false, customerId: plan.customerId, reason: plan.reason };
    }

    logger.info(
      `Quiz ${plan.quizResultId}: email set from ${source}` +
        (plan.merged ? ` — merged into existing customer ${plan.customerId}` : ` on customer ${plan.customerId}`)
    );

    await this.followAtStripe(plan);

    // The welcome email has been waiting for exactly this when the payment
    // came first, which is every wallet payment. It claims a dedup row before
    // sending, so a call that finds it already sent costs nothing.
    if (plan.firstSalePaid) {
      void emailTransactionalService
        .sendWelcome(plan.quizResultId)
        .catch((err) => logger.error(`Welcome email dispatch failed: ${err?.message ?? err}`));
    }

    return { applied: true, merged: plan.merged, customerId: plan.customerId };
  }

  // -------------------------------------------------------------------------
  // The database half
  // -------------------------------------------------------------------------

  private decide(quizResultId: string, email: string, source: EmailSource): Promise<Plan> {
    return AppDataSource.transaction(async (m) => {
      const quiz = await m
        .getRepository(CustomerQuizResult)
        .createQueryBuilder('q')
        .setLock('pessimistic_write')
        .where('q.id = :id', { id: quizResultId })
        .getOne();

      if (!quiz) {
        throw new AppError('Quiz result not found', 404);
      }

      const customers = m.getRepository(Customer);
      const current = quiz.customer_id
        ? await customers
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id = :id', { id: quiz.customer_id })
            .getOne()
        : null;

      const firstSale = await m.getRepository(CustomerQuizResultPaymentTransaction).findOne({
        where: { customer_quiz_result_id: quiz.id, transaction_type: 'first_sale', status: 'succeeded' }
      });
      const firstSalePaid = Boolean(firstSale);

      // The fallback fills a gap and nothing more. Someone already typed an
      // address — or the wallet's was applied on an earlier tick — so it stands.
      if (source === 'wallet_fallback' && current && !isPlaceholderEmail(current.email)) {
        await this.clearPending(m, quiz);
        return { kind: 'noop', customerId: current.id, reason: 'a real address is already in place' };
      }

      if (current && current.email.toLowerCase() === email) {
        quiz.email = current.email;
        await this.clearPending(m, quiz);
        return { kind: 'noop', customerId: current.id, reason: 'already this address' };
      }

      const owner = await customers
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('LOWER(c.email) = :email', { email })
        .andWhere('c.id <> :currentId', { currentId: current?.id ?? '0' })
        .getOne();

      // A placeholder customer only ever has the one attempt it was made for,
      // so "exclusive" is what lets it be renamed or retired outright.
      const exclusive = current
        ? (await m.getRepository(CustomerQuizResult).count({ where: { customer_id: current.id } })) === 1
        : false;

      // A paid attempt on a customer who has others stays put. Reachable only
      // through a narrow race — the fallback merged the attempt into a
      // returning customer, then a different address arrived from the details
      // page — and moving it would split one person's billing across two
      // accounts. Logged so it can be looked at; nothing is lost by staying.
      if (current && !exclusive && firstSalePaid) {
        logger.warn(
          `Quiz ${quiz.id}: not moving a paid attempt off shared customer ${current.id} ` +
            `to a different address (${source}).`
        );
        await this.clearPending(m, quiz);
        return { kind: 'noop', customerId: current.id, reason: 'paid attempt on a shared account' };
      }

      let target: Customer;
      let retired: Customer | null = null;
      const merged = Boolean(owner);

      if (owner) {
        target = owner;
        if (current && exclusive) retired = current;
      } else if (current && exclusive) {
        // Nobody else has this address: the attempt's own customer takes it.
        current.email = email;
        target = await customers.save(current);
      } else {
        // The attempt sits on someone else's account (or none): this address
        // is a new person, and gets a customer of their own.
        target = await customers.save(
          customers.create({
            email,
            password_hash: crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'),
            status: 'inactive'
          })
        );
      }

      const subscriptions = m.getRepository(CustomerSubscription);
      const moving = await subscriptions.find({ where: { customer_quiz_result_id: quiz.id } });
      // Read before anything moves: "did the target already have a plan" has
      // to be answered about the target as it was.
      const targetLiveBefore = merged
        ? (await subscriptions.find({ where: { customer_id: target.id } })).filter(
            (s) => !ENDED_STATUSES.has(s.status)
          )
        : [];

      if (!current || target.id !== current.id) {
        await this.moveAttempt(m, quiz, target.id, retired?.id ?? null);
      }

      // The card this attempt paid with lives on the Stripe Customer it was
      // paid through, and the cross-sale charges `customer.stripe_customer_id`
      // with that card. So the Stripe Customer goes where the attempt goes.
      // Taken off the retired row first, so no two customers claim one Stripe
      // Customer — the webhook resolves subscriptions by that id.
      const carried = current?.stripe_customer_id ?? null;
      if (retired && carried && firstSalePaid) {
        if (target.stripe_customer_id && target.stripe_customer_id !== carried) {
          logger.warn(
            `Customer ${target.id}: Stripe customer ${target.stripe_customer_id} replaced by ` +
              `${carried}, which holds the card for quiz ${quiz.id}. Older subscriptions still ` +
              'resolve through their own rows.'
          );
        }
        retired.stripe_customer_id = null;
        await customers.save(retired);
        target.stripe_customer_id = carried;
      } else if (!retired && carried && firstSalePaid && !target.stripe_customer_id) {
        target.stripe_customer_id = carried;
      }

      if (firstSalePaid) {
        // The settlement activated the placeholder, not the person.
        target.status = 'active';
      }
      target = await customers.save(target);

      if (retired) {
        // Retired, not deleted: it may be referenced from logs, and a deletion
        // would cascade into history. Its address is set back to the attempt's
        // placeholder so a real address it may have held is free again — a
        // later attempt with that address must find the live customer, not
        // this one.
        retired.status = 'merged';
        retired.email = placeholderEmailFor(quiz.id);
        await customers.save(retired);
      }

      quiz.customer_id = target.id;
      quiz.email = target.email;
      await this.clearPending(m, quiz);

      const movedIds = new Set(moving.map((s) => s.id));
      const duplicates =
        targetLiveBefore.some((s) => !movedIds.has(s.id))
          ? moving.filter((s) => !ENDED_STATUSES.has(s.status))
          : [];

      return {
        kind: 'applied',
        quizResultId: quiz.id,
        customerId: target.id,
        email: target.email,
        merged,
        firstSalePaid,
        stripeCustomerId: target.stripe_customer_id,
        movedSubscriptions: moving,
        duplicateSubscriptions: duplicates,
        firstSaleIntentId: firstSale?.stripe_payment_intent_id ?? null
      };
    });
  }

  /**
   * Re-home an attempt: the quiz row, every payment made against it, and its
   * subscription. When the old customer is being retired, anything else still
   * pointing at it comes too — it was only ever this attempt's.
   */
  private async moveAttempt(
    m: EntityManager,
    quiz: CustomerQuizResult,
    targetId: string,
    retiredId: string | null
  ): Promise<void> {
    const transactions = m.getRepository(CustomerQuizResultPaymentTransaction);
    const subscriptions = m.getRepository(CustomerSubscription);

    await transactions.update({ customer_quiz_result_id: quiz.id }, { customer_id: targetId });
    await subscriptions.update({ customer_quiz_result_id: quiz.id }, { customer_id: targetId });

    if (retiredId) {
      await transactions.update({ customer_id: retiredId }, { customer_id: targetId });
      await subscriptions.update({ customer_id: retiredId }, { customer_id: targetId });
      await m
        .getRepository(CustomerQuizResult)
        .update({ customer_id: retiredId }, { customer_id: targetId });
    }
  }

  private async clearPending(m: EntityManager, quiz: CustomerQuizResult): Promise<void> {
    quiz.pending_email = null;
    quiz.pending_email_due_at = null;
    await m.getRepository(CustomerQuizResult).save(quiz);
  }

  // -------------------------------------------------------------------------
  // The Stripe half — after commit, best-effort, never throws
  // -------------------------------------------------------------------------

  private async followAtStripe(plan: Extract<Plan, { kind: 'applied' }>): Promise<void> {
    const cancelling = new Set(plan.duplicateSubscriptions.map((s) => s.stripe_subscription_id));

    if (plan.stripeCustomerId) {
      await this.attempt(`update Stripe customer ${plan.stripeCustomerId} email`, () =>
        stripe.customers.update(plan.stripeCustomerId!, { email: plan.email })
      );
    }

    for (const sub of plan.movedSubscriptions) {
      if (cancelling.has(sub.stripe_subscription_id)) continue;
      await this.attempt(`update subscription ${sub.stripe_subscription_id} metadata`, () =>
        stripe.subscriptions.update(sub.stripe_subscription_id, {
          metadata: { customer_email: plan.email }
        })
      );
    }

    if (plan.firstSaleIntentId) {
      await this.attempt(`update PaymentIntent ${plan.firstSaleIntentId} metadata`, () =>
        stripe.paymentIntents.update(plan.firstSaleIntentId!, {
          metadata: { customer_email: plan.email }
        })
      );
    }

    for (const sub of plan.duplicateSubscriptions) {
      await this.cancelDuplicate(sub, plan.customerId);
    }
  }

  /**
   * Cancel a trial that duplicates a plan the customer already has.
   *
   * Immediately, not at period end: it is in its free trial, nothing has been
   * charged, and leaving it to run would bill the customer twice every 28 days
   * from the end of it. Logged as an error when Stripe refuses, because that
   * is a double charge waiting to happen and someone needs to see it.
   */
  private async cancelDuplicate(sub: CustomerSubscription, customerId: string): Promise<void> {
    try {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    } catch (err: any) {
      logger.error(
        `DUPLICATE SUBSCRIPTION NOT CANCELLED: ${sub.stripe_subscription_id} on customer ` +
          `${customerId} duplicates an existing plan and Stripe refused the cancellation ` +
          `(${err?.message ?? err}). Cancel it by hand before its trial ends.`
      );
      return;
    }

    await AppDataSource.getRepository(CustomerSubscription).update(sub.id, {
      status: 'canceled',
      canceled_at: new Date(),
      cancel_reason: 'duplicate of an existing plan, found when the email address was merged'
    });

    logger.warn(
      `Subscription ${sub.stripe_subscription_id} cancelled: customer ${customerId} already held a ` +
        'live plan, found when their real email address arrived.'
    );
  }

  private async attempt(label: string, call: () => Promise<unknown>): Promise<void> {
    try {
      await call();
    } catch (err: any) {
      logger.error(`Could not ${label}: ${err?.message ?? err}`);
    }
  }
}

export const customerEmailService = new CustomerEmailService();
