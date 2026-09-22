import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { paymentService } from '../services/payment.service.js';
import { logger } from '../utils/logger.util.js';

/**
 * Repairs subscription rows that went stale, from Stripe.
 *
 *   npm run resync:subscriptions
 *   npm run resync:subscriptions -- sub_1ABC...   (one subscription only)
 *
 * Two things had stopped being written, and neither fills itself in:
 *
 * - **The billing period.** It was read from `current_period_end` on the
 *   Subscription, which Stripe moved onto the subscription items in API version
 *   2025-03-31. Webhooks arrive in the account's API version, so the columns
 *   quietly stopped updating and a subscription that had converted from trial
 *   kept showing the trial's dates.
 * - **Recurring charges.** Nothing handled the invoice events, so no renewal ever
 *   reached `customer_quiz_result_payment_transactions`.
 *
 * The webhooks now keep both current, so this is a one-off catch-up for what was
 * missed rather than something to schedule.
 *
 * Idempotent: the period is overwritten with Stripe's answer and each invoice
 * lands on its own row keyed by invoice id, so a re-run after a partial one is
 * safe and adds nothing twice.
 */
async function resync(): Promise<void> {
  await AppDataSource.initialize();

  // Everything after `--`, so a single subscription id can be passed through npm.
  const only = process.argv.slice(2).filter((arg) => arg.startsWith('sub_'));

  const subscriptions = await AppDataSource.getRepository(CustomerSubscription).find({
    order: { id: 'ASC' }
  });

  const targets = only.length
    ? subscriptions.filter((s) => only.includes(s.stripe_subscription_id))
    : subscriptions;

  if (only.length && !targets.length) {
    logger.error(`None of ${only.join(', ')} exist in customer_subscriptions`);
    await AppDataSource.destroy();
    process.exit(1);
  }

  logger.info(`Re-syncing ${targets.length} subscription(s) from Stripe`);

  let repaired = 0;
  let charges = 0;
  let failed = 0;

  for (const subscription of targets) {
    if (!subscription.stripe_subscription_id) continue;

    try {
      const result = await paymentService.resyncSubscription(subscription.stripe_subscription_id);

      if (!result.found) {
        // The row exists here but Stripe does not know the subscription — worth
        // seeing rather than counting as a success.
        logger.warn(
          `Subscription ${subscription.stripe_subscription_id} could not be resolved at Stripe`
        );
        failed += 1;
        continue;
      }

      repaired += 1;
      charges += result.invoicesLogged;

      if (result.invoicesLogged > 0) {
        logger.info(
          `${subscription.stripe_subscription_id}: ${result.invoicesLogged} missing charge(s) logged`
        );
      }
    } catch (error: any) {
      failed += 1;
      logger.error(
        `Re-sync failed for ${subscription.stripe_subscription_id}: ${error?.message ?? error}`
      );
    }
  }

  logger.info(
    `Re-sync complete: ${repaired} subscription(s) refreshed, ${charges} charge(s) added to the ledger, ${failed} failed`
  );

  await AppDataSource.destroy();
}

resync().catch((error) => {
  logger.error(`Re-sync aborted: ${error?.message ?? error}`);
  process.exit(1);
});
