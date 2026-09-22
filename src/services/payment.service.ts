import Stripe from 'stripe';
import { config } from '../config/env.config.js';
import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { currencyRateService } from './currency-rate.service.js';
import { stripe } from '../config/stripe.config.js';
import { externalApiLogService, EXTERNAL_API_SERVICE } from './external-api-log.service.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { getPricingByLanguage, applyDiscount, resolveDiscountCode } from '../constants/pricing.constants.js';
import { emailTransactionalService } from './email-transactional.service.js';
import { logger } from '../utils/logger.util.js';
import { resolveFunnelRedirect, FunnelRedirect } from '../utils/funnel-redirect.util.js';
import { readSubscriptionPeriod } from '../utils/stripe-period.util.js';

export interface SubscriptionOutcome {
  created: boolean;
  subscription_id: string | null;
  status: string | null;
  /** Why no subscription was started, when created is false. */
  reason: string | null;
}

/** Postgres `unique_violation` — two settles inserting the same row at once. */
const UNIQUE_VIOLATION = '23505';

/** No subscription, and why. */
function subscriptionSkipped(reason: string): SubscriptionOutcome {
  return { created: false, subscription_id: null, status: null, reason };
}

export interface FirstSaleConfirmResult {
  status: Stripe.PaymentIntent.Status;
  payment_intent_id: string;
  paid: boolean;
  requires_action: boolean;
  client_secret: string | null;
  amount: number;
  currency: string;
  redirect_url: FunnelRedirect;
  subscription: SubscriptionOutcome;
}

export interface CrossSaleConfirmResult {
  status: Stripe.PaymentIntent.Status;
  payment_intent_id: string;
  paid: boolean;
  requires_action: boolean;
  client_secret: string | null;
  amount: number;
  currency: string;
  redirect_url: FunnelRedirect;
}

export class PaymentService {
  private stripe: Stripe;
  private quizResultRepository = AppDataSource.getRepository(CustomerQuizResult);
  private transactionRepository = AppDataSource.getRepository(CustomerQuizResultPaymentTransaction);
  private customerRepository = AppDataSource.getRepository(Customer);
  private subscriptionRepository = AppDataSource.getRepository(CustomerSubscription);

  constructor() {
    // The shared client: pinned API version and outgoing-call logging live with
    // it, so every service sees the same Stripe and the same log coverage.
    this.stripe = stripe;
  }

  private async findQuizResult(identifier: string): Promise<CustomerQuizResult> {
    let numericId: string;
    try {
      numericId = EncryptionUtil.decryptId(identifier);
    } catch {
      throw new AppError('Invalid quiz_id', 400);
    }

    const res = await this.quizResultRepository.findOne({
      where: { id: numericId },
      relations: ['customer']
    });

    if (!res) {
      throw new AppError('Quiz result not found', 404);
    }
    return res;
  }

  /**
   * Create Stripe PaymentIntent for First Sale
   */
  async createFirstSalePaymentIntent(params: {
    quiz_id: string;
    language?: string;
    price_dis?: string;
  }): Promise<{
    client_secret: string;
    payment_intent_id: string;
    amount: number;
    original_amount: number;
    discount_percentage: number;
    discount_code: string | null;
    currency: string;
  }> {
    const { quiz_id, language, price_dis } = params;
    const quizResult = await this.findQuizResult(quiz_id);

    // Determine language pricing: passed in request or from saved quiz result
    const selectedLang = language || quizResult.language || 'ja';
    const pricingConfig = getPricingByLanguage(selectedLang);

    // Re-resolve the code here rather than trusting whatever reached the client:
    // this endpoint decides what Stripe actually charges.
    const discount = price_dis ? resolveDiscountCode(price_dis) : null;
    if (price_dis && !discount) {
      throw new AppError(`Discount code "${price_dis}" is not valid`, 400);
    }

    const product = applyDiscount(pricingConfig.first_sale, discount?.percent ?? 0);

    // Never start a second charge for a sale that already went through
    const alreadyPaid = await this.transactionRepository.findOne({
      where: {
        customer_quiz_result_id: quizResult.id,
        transaction_type: 'first_sale',
        status: 'succeeded'
      }
    });

    if (alreadyPaid) {
      throw new AppError('The first sale has already been paid for this quiz', 409);
    }

    // This endpoint is the moment the customer initiates payment, so it owns the
    // transaction row. Re-initiating (a retry, a refresh) must reuse the pending
    // attempt rather than stacking another row and another PaymentIntent.
    const reused = await this.reusablePendingIntent(quizResult, product, discount?.code || null);
    if (reused) {
      return reused;
    }

    // The cross-sale charges this same card off-session later, so the first sale
    // must attach a Stripe Customer and save the payment method for reuse.
    // Created here — at initiation — not when the customer submitted their email.
    const stripeCustomerId = await this.getOrCreateStripeCustomer(quizResult);

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripe.paymentIntents.create({
        amount: product.stripe_amount,
        currency: product.currency.toLowerCase(),
        // Required for export transactions on India-registered Stripe accounts
        // (https://stripe.com/docs/india-exports) and useful on every dashboard row.
        //
        // English, never `product.title`: the Japanese funnel's title is for the
        // customer's screen, and Stripe's side is read by people who do not read it.
        description: product.stripe_description,
        customer: stripeCustomerId,
        // Saves the card so the cross-sale can charge it without a payment sheet
        setup_future_usage: 'off_session',
        metadata: {
          quiz_id,
          customer_email: quizResult.email,
          transaction_type: 'first_sale',
          language: selectedLang,
          discount_percentage: String(product.discount_percentage),
          discount_code: discount?.code || '',
          original_amount: String(product.original_price)
        },
        // Card only, deliberately. The checkout offers exactly three ways to
        // pay — Apple Pay, Google Pay and a card — and the two wallets are
        // card-backed, so this one type covers all three while keeping Link,
        // PayPal and anything else enabled in the Dashboard out of the sheet.
        //
        // It must also match what the frontend passes to `stripe.elements()`:
        // in the deferred-intent flow Stripe compares the two and refuses the
        // confirmation if the payment method types disagree.
        payment_method_types: ['card']
      });
    } catch (err: any) {
      throw new AppError(`Payment provider error: ${err.message}`, 400);
    }

    // Record pending transaction in DB. The GBP figure is worked out from the
    // rates already stored — see `convertToGbp` — so a slow or unreachable
    // exchange rate provider can never hold up a payment.
    const transaction = this.transactionRepository.create({
      customer_quiz_result_id: quizResult.id,
      customer_id: quizResult.customer_id,
      transaction_type: 'first_sale',
      amount: product.amount.toString(),
      currency: product.currency,
      amount_gbp: await currencyRateService.convertToGbp(product.amount, product.currency),
      status: 'pending',
      stripe_payment_intent_id: paymentIntent.id
    });
    await this.transactionRepository.save(transaction);

    if (!paymentIntent.client_secret) {
      throw new AppError('Failed to generate payment client secret', 500);
    }

    return {
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: product.amount,
      original_amount: product.original_price,
      discount_percentage: product.discount_percentage,
      discount_code: discount?.code || null,
      currency: product.currency
    };
  }

  /**
   * Return the still-usable PaymentIntent from an earlier initiation, if there is one.
   *
   * Keeps one pending transaction row per quiz attempt instead of one per click.
   * Anything unusable (wrong amount, already processing, deleted at Stripe) falls
   * through so a fresh intent is created.
   */
  private async reusablePendingIntent(
    quizResult: CustomerQuizResult,
    product: {
      amount: number;
      currency: string;
      stripe_amount: number;
      original_price: number;
      discount_percentage: number;
    },
    discountCode: string | null
  ): Promise<{
    client_secret: string;
    payment_intent_id: string;
    amount: number;
    original_amount: number;
    discount_percentage: number;
    discount_code: string | null;
    currency: string;
  } | null> {
    const pending = await this.transactionRepository.findOne({
      where: {
        customer_quiz_result_id: quizResult.id,
        transaction_type: 'first_sale',
        status: 'pending'
      },
      order: { id: 'DESC' }
    });

    if (!pending?.stripe_payment_intent_id) {
      return null;
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.paymentIntents.retrieve(pending.stripe_payment_intent_id);
    } catch (err: any) {
      logger.warn(
        `Pending PaymentIntent ${pending.stripe_payment_intent_id} could not be read (${err.message}) — creating a new one`
      );
      return null;
    }

    const stillOpen =
      intent.status === 'requires_payment_method' ||
      intent.status === 'requires_confirmation' ||
      intent.status === 'requires_action';

    const matchesPrice =
      intent.amount === product.stripe_amount &&
      intent.currency === product.currency.toLowerCase();

    if (!stillOpen || !matchesPrice || !intent.client_secret) {
      return null;
    }

    logger.info(`Reusing pending PaymentIntent ${intent.id} for quiz ${quizResult.id}`);

    return {
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      amount: product.amount,
      original_amount: product.original_price,
      discount_percentage: product.discount_percentage,
      discount_code: discountCode,
      currency: product.currency
    };
  }

  /**
   * Settle the First Sale straight after Stripe.js reports success in the browser.
   *
   * The webhook does the same job, but it can lag by seconds; the funnel should not
   * make the customer wait for it. Both paths are idempotent, so whichever lands
   * first wins and the other is a no-op.
   *
   * The client's claim is never trusted: the PaymentIntent is re-read from Stripe
   * and the stored transaction is settled from that.
   */
  async confirmFirstSalePayment(params: {
    quiz_id: string;
    payment_intent_id: string;
  }): Promise<FirstSaleConfirmResult> {
    const { quiz_id, payment_intent_id } = params;

    const quizResult = await this.findQuizResult(quiz_id);

    // Match on all three so a caller holding one quiz_id cannot settle another
    // customer's PaymentIntent by guessing its id.
    const transaction = await this.transactionRepository.findOne({
      where: {
        stripe_payment_intent_id: payment_intent_id,
        customer_quiz_result_id: quizResult.id,
        transaction_type: 'first_sale'
      }
    });

    if (!transaction) {
      throw new AppError(
        'No first_sale transaction found for this quiz_id and payment_intent_id',
        404
      );
    }

    if (transaction.status === 'succeeded' || transaction.status === 'refunded') {
      return {
        status: transaction.status === 'succeeded' ? 'succeeded' : 'canceled',
        payment_intent_id,
        paid: transaction.status === 'succeeded',
        requires_action: false,
        client_secret: null,
        amount: parseFloat(transaction.amount),
        currency: transaction.currency,
        redirect_url: await this.currentRedirect(quizResult.id),
        subscription:
          transaction.status === 'succeeded'
            ? await this.ensureSubscriptionOutcome(quizResult, transaction)
            : await this.existingSubscriptionOutcome(quizResult)
      };
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripe.paymentIntents.retrieve(payment_intent_id);
    } catch (err: any) {
      logger.error(`Could not read PaymentIntent ${payment_intent_id}: ${err.message}`);
      throw new AppError(`Could not read the payment from Stripe: ${err.message}`, 502);
    }

    // Settling now owns the saved card and the recurring plan too, so the
    // webhook reaches them as well — see `settleTransactionFromIntent`. The
    // quiz result is handed over rather than re-read.
    const subscription =
      (await this.settleTransactionFromIntent(transaction, paymentIntent, quizResult)) ??
      subscriptionSkipped('first sale not settled');

    return {
      status: paymentIntent.status,
      payment_intent_id: paymentIntent.id,
      paid: paymentIntent.status === 'succeeded',
      requires_action: paymentIntent.status === 'requires_action',
      client_secret: paymentIntent.client_secret,
      amount: parseFloat(transaction.amount),
      currency: transaction.currency,
      redirect_url: await this.currentRedirect(quizResult.id),
      subscription
    };
  }

  /**
   * The subscription for a first sale that is already settled.
   *
   * Normally just a lookup: the webhook, or an earlier confirm, created it.
   * When there is no row the creation is retried here, because nothing else
   * will. Stripe delivers `payment_intent.succeeded` once; if the subscription
   * call inside it failed — a rate limit, a network blip, a price that was
   * briefly archived — the customer is left charged with no plan and no second
   * event to notice it. A returning browser is the cheapest repair we have.
   */
  private async ensureSubscriptionOutcome(
    quizResult: CustomerQuizResult,
    transaction: CustomerQuizResultPaymentTransaction
  ): Promise<SubscriptionOutcome> {
    const existing = await this.existingSubscriptionOutcome(quizResult);

    // `enabled` is checked up front so a funnel running with subscriptions off
    // does not pay for a Stripe round trip on every refresh of a settled sale.
    if (existing.created || !config.subscription.enabled || !transaction.stripe_payment_intent_id) {
      return existing;
    }

    logger.warn(
      `Quiz ${quizResult.id}: first sale is settled but has no subscription — retrying creation`
    );

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripe.paymentIntents.retrieve(
        transaction.stripe_payment_intent_id
      );
    } catch (err: any) {
      logger.error(
        `Could not re-read PaymentIntent ${transaction.stripe_payment_intent_id}: ${err.message}`
      );
      return existing;
    }

    if (paymentIntent.status !== 'succeeded') {
      return existing;
    }

    return this.startSubscription(quizResult, paymentIntent);
  }

  /**
   * Report the subscription this customer already has, for repeat confirm calls.
   */
  private async existingSubscriptionOutcome(
    quizResult: CustomerQuizResult
  ): Promise<SubscriptionOutcome> {
    if (!quizResult.customer_id) {
      return { created: false, subscription_id: null, status: null, reason: 'no customer record' };
    }

    const record = await this.subscriptionRepository.findOne({
      where: { customer_quiz_result_id: quizResult.id },
      order: { id: 'DESC' }
    });

    if (!record) {
      return { created: false, subscription_id: null, status: null, reason: 'no subscription' };
    }

    return {
      created: true,
      subscription_id: record.stripe_subscription_id,
      status: record.status,
      reason: null
    };
  }

  /**
   * Create the recurring subscription against the card saved by the first sale.
   *
   * Never throws — every failure is reported through the returned outcome so the
   * caller can still answer a successful first sale.
   */
  private async startSubscription(
    quizResult: CustomerQuizResult,
    paymentIntent: Stripe.PaymentIntent
  ): Promise<SubscriptionOutcome> {
    try {
      if (!config.subscription.enabled) {
        return subscriptionSkipped('subscriptions disabled (SUBSCRIPTION_ENABLED=false)');
      }

      const plan = getPricingByLanguage(quizResult.language).subscription;
      if (!plan.price_id) {
        logger.warn(
          `Subscription skipped for quiz ${quizResult.id}: no Stripe Price id configured for language "${quizResult.language}"`
        );
        return subscriptionSkipped('no Stripe Price id configured for this language');
      }

      if (!quizResult.customer_id) {
        return subscriptionSkipped('quiz result has no customer record');
      }

      // One subscription per quiz attempt — a repeated confirm must not create another,
      // but a second quiz by the same customer gets its own plan.
      const existing = await this.subscriptionRepository.findOne({
        where: { customer_quiz_result_id: quizResult.id }
      });

      if (existing) {
        return {
          created: true,
          subscription_id: existing.stripe_subscription_id,
          status: existing.status,
          reason: null
        };
      }

      const customerId =
        typeof paymentIntent.customer === 'string'
          ? paymentIntent.customer
          : paymentIntent.customer?.id;

      const paymentMethodId =
        typeof paymentIntent.payment_method === 'string'
          ? paymentIntent.payment_method
          : paymentIntent.payment_method?.id;

      if (!customerId || !paymentMethodId) {
        return subscriptionSkipped('the first sale did not save a reusable card');
      }

      // Make the saved card the default for future invoices
      await this.stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId }
      });

      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: plan.price_id }],
        // Rides onto every invoice Stripe raises for this subscription, so the
        // renewals in the Dashboard read in English like the one-off charges do.
        description: plan.stripe_description,
        default_payment_method: paymentMethodId,
        off_session: true,
        payment_behavior: 'allow_incomplete',
        // The free trial. Nothing is charged until it ends, and Stripe reports
        // the subscription as `trialing` throughout — which already grants
        // access, and is what the welcome email's trial panel keys off.
        ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days } : {}),
        metadata: {
          quiz_result_id: String(quizResult.id),
          customer_email: quizResult.email,
          language: quizResult.language
        }
      }, {
        // The webhook and the confirm endpoint both settle a first sale, and
        // they can arrive at the same instant — the row check above is a read,
        // so both can pass it and both can get here. Without this key that is
        // two subscriptions on one customer and a double charge every 28 days.
        //
        // Keyed on the quiz attempt, which is exactly the scope the plan is
        // scoped to: one attempt, one subscription. Stripe replays the first
        // response for 24 hours, far longer than the two paths can be apart,
        // and expires long before a genuine retry of a *failed* creation would
        // come back — so a real failure is still retryable.
        idempotencyKey: `first-sale-subscription-${quizResult.id}`
      });

      await this.upsertSubscriptionRecord(subscription, quizResult.customer_id, quizResult.id);

      logger.info(
        `Subscription ${subscription.id} created for quiz ${quizResult.id} (status ${subscription.status})`
      );

      return {
        created: true,
        subscription_id: subscription.id,
        status: subscription.status,
        reason: null
      };
    } catch (err: any) {
      logger.error(`Subscription creation failed for quiz ${quizResult.id}: ${err.message}`);
      return subscriptionSkipped(`subscription could not be created: ${err.message}`);
    }
  }

  /**
   * Insert or update the local subscription row from a Stripe Subscription.
   * Shared by the first-sale flow and the webhook so both agree.
   */
  private async upsertSubscriptionRecord(
    subscription: Stripe.Subscription,
    customerId: string,
    quizResultId: string | null
  ): Promise<void> {
    const stripeCustomerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    let record = await this.subscriptionRepository.findOne({
      where: { stripe_subscription_id: subscription.id }
    });

    const item = subscription.items.data[0];
    const amount = item?.price?.unit_amount
      ? item.price.currency.toUpperCase() === 'JPY'
        ? item.price.unit_amount
        : item.price.unit_amount / 100
      : 0;

    // Never read straight off the subscription: Stripe moved these onto the
    // items in Basil, and webhooks arrive in the *account's* API version rather
    // than the one our SDK is pinned to. See `readSubscriptionPeriod`.
    let { start: periodStart, end: periodEnd } = readSubscriptionPeriod(subscription);

    // Neither shape carried a period — an event trimmed by an API version we did
    // not anticipate. Re-read the subscription through our own pinned version,
    // which is a shape we know, rather than leaving the dates stale for ever.
    if (!periodStart && !periodEnd) {
      try {
        const fresh = await this.stripe.subscriptions.retrieve(subscription.id);
        ({ start: periodStart, end: periodEnd } = readSubscriptionPeriod(fresh));
      } catch (err: any) {
        logger.warn(
          `Could not re-read subscription ${subscription.id} for its billing period: ${err.message}`
        );
      }
    }

    if (!record) {
      record = this.subscriptionRepository.create({
        customer_id: customerId,
        customer_quiz_result_id: quizResultId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: stripeCustomerId,
        status: subscription.status,
        plan_name: item?.price?.nickname || 'myIQ Cognitive Training Program',
        amount: amount.toString(),
        currency: (item?.price?.currency || 'jpy').toUpperCase(),
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        current_period_start: periodStart,
        current_period_end: periodEnd
      });
    } else {
      record.status = subscription.status;
      // A membership cancelled from the members' area, or from Stripe's billing
      // portal, stays `active` until its period runs out — this flag is the only
      // thing that distinguishes "cancelling on the 18th" from "renewing on the
      // 18th", so it has to ride along with the status it qualifies.
      record.cancel_at_period_end = Boolean(subscription.cancel_at_period_end);
      // The whole point of this method for a renewal or a trial conversion: the
      // period has moved on, and these two columns are what the members' area
      // and the admin read to say when the next charge lands.
      if (periodStart) record.current_period_start = periodStart;
      if (periodEnd) record.current_period_end = periodEnd;
      // Backfill the quiz link for rows written before the reference existed
      if (!record.customer_quiz_result_id && quizResultId) {
        record.customer_quiz_result_id = quizResultId;
      }
      // The cached card is dropped rather than refreshed here: changing a card
      // in Stripe's billing portal produces this event, and re-reading it now
      // would put a Stripe call on the webhook's critical path. The members'
      // area refills it on the next read, which is the request that needs it.
      record.card_brand = null;
      record.card_last4 = null;
      record.card_exp_month = null;
      record.card_exp_year = null;
    }

    try {
      await this.subscriptionRepository.save(record);
    } catch (err: any) {
      // The other settle path inserted this same subscription between our read
      // above and this write. Both were handed the same Stripe subscription by
      // the idempotency key on `subscriptions.create`, so the row that won the
      // race is the row we were about to write — adopt it instead of failing,
      // which would log a subscription error for a subscription that exists.
      const code = err?.code ?? err?.driverError?.code;
      if (code !== UNIQUE_VIOLATION) {
        throw err;
      }
      logger.info(
        `Subscription ${subscription.id} was written concurrently — keeping the row already stored`
      );
    }
  }

  /**
   * Re-read the funnel position after a transaction has been settled.
   */
  private async currentRedirect(quizResultId: string): Promise<FunnelRedirect> {
    const fresh = await this.quizResultRepository.findOne({
      where: { id: quizResultId },
      relations: ['transactions']
    });

    return fresh ? resolveFunnelRedirect(fresh) : 'CHECKOUT_PAGE';
  }

  /**
   * Map a PaymentIntent status onto a stored transaction, activate the customer,
   * and — for a first sale — save the card and start the recurring plan.
   *
   * Everything a paid first sale must produce lives here rather than in the
   * confirm endpoint, because the webhook is the only path Stripe guarantees.
   * A customer who pays through a bank app and never comes back to the tab, or
   * who closes it the moment the sheet succeeds, still gets their subscription.
   * Both paths run through here and every step is idempotent, so whichever
   * lands first does the work and the other is a no-op.
   *
   * Returns the subscription outcome for a first sale, so the confirm endpoint
   * can report it without repeating the work; null for anything else.
   */
  private async settleTransactionFromIntent(
    transaction: CustomerQuizResultPaymentTransaction,
    paymentIntent: Stripe.PaymentIntent,
    known?: CustomerQuizResult
  ): Promise<SubscriptionOutcome | null> {
    switch (paymentIntent.status) {
      case 'succeeded':
        transaction.status = 'succeeded';
        break;
      case 'canceled':
        transaction.status = 'failed';
        break;
      default:
        // requires_action, requires_payment_method, processing, requires_confirmation
        transaction.status = 'pending';
    }

    transaction.stripe_charge_id =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id || transaction.stripe_charge_id || null;

    await this.transactionRepository.save(transaction);

    // Only the first sale opens an account and a plan; this method settles the
    // cross-sale and subscription intents too, and those are neither.
    const isFirstSale = transaction.transaction_type === 'first_sale';
    const quizResult = isFirstSale ? await this.quizResultFor(transaction, known) : null;

    // Worth storing before the payment settles as well as after: an intent that
    // is still waiting on 3-D Secure already carries a card, and the cross-sale
    // reads it from our own database rather than calling Stripe again.
    if (quizResult) {
      await this.storePaymentMethodOnQuiz(quizResult, paymentIntent);
    }

    if (paymentIntent.status !== 'succeeded') {
      return isFirstSale ? subscriptionSkipped('first sale not paid') : null;
    }

    if (!transaction.customer_id) {
      return isFirstSale ? subscriptionSkipped('transaction has no customer record') : null;
    }

    // Activate the account. The welcome email below issues its password, so
    // from this point the customer can actually sign in to the training program.
    const customer = await this.customerRepository.findOne({
      where: { id: transaction.customer_id }
    });

    if (!customer) {
      return isFirstSale ? subscriptionSkipped('customer record not found') : null;
    }

    customer.status = 'active';
    if (typeof paymentIntent.customer === 'string') {
      customer.stripe_customer_id = paymentIntent.customer;
    }
    await this.customerRepository.save(customer);

    if (!isFirstSale) {
      return null;
    }

    // Start the recurring plan on the card just used, and await it, unlike the
    // email below. Two Stripe calls cost a fraction of a second, and a webhook
    // that does not wait for them cannot be the path the subscription is
    // guaranteed by, which is the whole reason this moved here.
    //
    // It also has to finish before the welcome email is dispatched: that email
    // renders its "your free trial is active" panel from the row written here,
    // and a customer told nothing about a trial they do have will read the
    // first charge as a mistake.
    //
    // Still best-effort. The money has already moved, so a subscription problem
    // is logged and reported, never thrown — it must not fail the confirm
    // response, and it must not hand the webhook a non-2xx, which would have
    // Stripe redeliver the event and settle it all over again.
    const subscription = quizResult
      ? await this.startSubscription(quizResult, paymentIntent)
      : subscriptionSkipped('transaction has no quiz result');

    // The welcome email, with the customer's myIQ Cognitive Training Program credentials.
    //
    // Deliberately not awaited. The customer's money has already moved, and a
    // slow or unhappy email provider must not delay a confirm response or push
    // a Stripe webhook towards its timeout — which would have Stripe retry the
    // event and settle it all over again. The service claims a dedup row before
    // it sends, so the retry that this protects against could not double-send
    // anyway, and every failure inside it is caught and logged.
    void emailTransactionalService
      .sendWelcome(transaction.customer_quiz_result_id)
      .catch((err) => logger.error(`Welcome email dispatch failed: ${err?.message ?? err}`));

    return subscription;
  }

  /**
   * The quiz attempt a transaction belongs to, reusing the one the caller has
   * already loaded so the confirm endpoint does not read it a second time.
   */
  private async quizResultFor(
    transaction: CustomerQuizResultPaymentTransaction,
    known?: CustomerQuizResult
  ): Promise<CustomerQuizResult | null> {
    if (known) {
      return known;
    }

    if (!transaction.customer_quiz_result_id) {
      return null;
    }

    return this.quizResultRepository.findOne({
      where: { id: transaction.customer_quiz_result_id },
      relations: ['customer']
    });
  }

  /**
   * Confirm the Cross Sale by charging the card saved during the first sale.
   *
   * There is no payment sheet for the upsell: the customer simply accepts, and we
   * charge the stored payment method off-session (merchant-initiated).
   */
  async confirmCrossSalePayment(params: {
    quiz_id: string;
    language?: string;
  }): Promise<CrossSaleConfirmResult> {
    const { quiz_id, language } = params;
    const quizResult = await this.findQuizResult(quiz_id);

    const selectedLang = language || quizResult.language || 'ja';
    const product = getPricingByLanguage(selectedLang).cross_sale;

    // Already accepted — never charge twice for a double-click
    const settled = await this.transactionRepository.findOne({
      where: {
        customer_quiz_result_id: quizResult.id,
        transaction_type: 'cross_sale',
        status: 'succeeded'
      }
    });

    if (settled) {
      return {
        status: 'succeeded',
        payment_intent_id: settled.stripe_payment_intent_id || '',
        paid: true,
        requires_action: false,
        client_secret: null,
        amount: parseFloat(settled.amount),
        currency: settled.currency,
        redirect_url: await this.currentRedirect(quizResult.id)
      };
    }

    // The saved card comes from the first sale, so it must have completed
    const firstSale = await this.transactionRepository.findOne({
      where: {
        customer_quiz_result_id: quizResult.id,
        transaction_type: 'first_sale',
        status: 'succeeded'
      }
    });

    if (!firstSale) {
      throw new AppError(
        'The first sale must be completed before the cross-sale can be charged',
        409
      );
    }

    const { customerId, paymentMethodId, source } = await this.resolveSavedPaymentMethod(
      quizResult,
      firstSale
    );
    logger.info(`Cross-sale for quiz ${quizResult.id}: card resolved from ${source}`);

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripe.paymentIntents.create({
        amount: product.stripe_amount,
        currency: product.currency.toLowerCase(),
        // English on Stripe, in every language we sell in — see the first sale.
        description: product.stripe_description,
        customer: customerId,
        payment_method: paymentMethodId,
        // Merchant-initiated: the customer is not completing a payment sheet
        off_session: true,
        confirm: true,
        metadata: {
          quiz_id,
          customer_email: quizResult.email,
          transaction_type: 'cross_sale',
          language: selectedLang
        }
      });
    } catch (err: any) {
      // A saved card can still demand 3D Secure. Stripe raises this as an error but
      // hands back the PaymentIntent, so surface it for the frontend to finish.
      const raised: Stripe.PaymentIntent | undefined = err?.raw?.payment_intent;

      if (raised) {
        await this.recordCrossSaleTransaction(quizResult, product, raised);

        if (err.code === 'authentication_required') {
          return {
            status: raised.status,
            payment_intent_id: raised.id,
            paid: false,
            requires_action: true,
            client_secret: raised.client_secret,
            amount: product.amount,
            currency: product.currency,
            redirect_url: await this.currentRedirect(quizResult.id)
          };
        }
      }

      logger.error(
        `Cross-sale off-session charge failed for quiz ${quizResult.id}: ${err.message}`
      );
      throw new AppError(`Cross-sale payment failed: ${err.message}`, 400);
    }

    await this.recordCrossSaleTransaction(quizResult, product, paymentIntent);

    return {
      status: paymentIntent.status,
      payment_intent_id: paymentIntent.id,
      paid: paymentIntent.status === 'succeeded',
      requires_action: paymentIntent.status === 'requires_action',
      client_secret: paymentIntent.client_secret,
      amount: product.amount,
      currency: product.currency,
      redirect_url: await this.currentRedirect(quizResult.id)
    };
  }

  /**
   * Save the card used by a PaymentIntent onto the quiz result.
   *
   * Never throws: losing this is recoverable (the Stripe fallback covers it), and it
   * must not fail a request for a payment that already went through.
   */
  private async storePaymentMethodOnQuiz(
    quizResult: CustomerQuizResult,
    paymentIntent: Stripe.PaymentIntent
  ): Promise<void> {
    const paymentMethodId =
      typeof paymentIntent.payment_method === 'string'
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id;

    if (!paymentMethodId || quizResult.stripe_payment_method_id === paymentMethodId) {
      return;
    }

    try {
      quizResult.stripe_payment_method_id = paymentMethodId;
      await this.quizResultRepository.save(quizResult);
    } catch (err: any) {
      logger.error(
        `Could not store payment method on quiz ${quizResult.id}: ${err.message}`
      );
    }
  }

  /**
   * Find the customer + card to charge for a follow-up sale.
   *
   * Database first — that is the whole point of storing the payment method on the
   * quiz result. Stripe is only consulted when the local record is missing or the
   * stored card turns out to be unusable.
   */
  private async resolveSavedPaymentMethod(
    quizResult: CustomerQuizResult,
    firstSale: CustomerQuizResultPaymentTransaction
  ): Promise<{ customerId: string; paymentMethodId: string; source: 'database' | 'stripe' }> {
    const storedPaymentMethod = quizResult.stripe_payment_method_id;
    const storedCustomer = quizResult.customer?.stripe_customer_id;

    if (storedPaymentMethod && storedCustomer) {
      return { customerId: storedCustomer, paymentMethodId: storedPaymentMethod, source: 'database' };
    }

    logger.info(
      `Quiz ${quizResult.id}: no stored payment method, falling back to Stripe for the first sale card`
    );

    if (!firstSale.stripe_payment_intent_id) {
      throw new AppError('The first sale has no PaymentIntent to read a saved card from', 409);
    }

    let firstSaleIntent: Stripe.PaymentIntent;
    try {
      firstSaleIntent = await this.stripe.paymentIntents.retrieve(
        firstSale.stripe_payment_intent_id
      );
    } catch (err: any) {
      throw new AppError(`Could not read the first sale from Stripe: ${err.message}`, 502);
    }

    const paymentMethodId =
      storedPaymentMethod ||
      (typeof firstSaleIntent.payment_method === 'string'
        ? firstSaleIntent.payment_method
        : firstSaleIntent.payment_method?.id);

    const customerId =
      storedCustomer ||
      (typeof firstSaleIntent.customer === 'string'
        ? firstSaleIntent.customer
        : firstSaleIntent.customer?.id);

    if (!paymentMethodId || !customerId) {
      throw new AppError(
        'No saved payment method is available for this customer — the first sale did not store one',
        409
      );
    }

    // Backfill so the next charge can skip Stripe entirely
    await this.storePaymentMethodOnQuiz(quizResult, firstSaleIntent);

    return { customerId, paymentMethodId, source: 'stripe' };
  }

  /**
   * Insert or update the cross-sale transaction row from a PaymentIntent.
   */
  private async recordCrossSaleTransaction(
    quizResult: CustomerQuizResult,
    product: { amount: number; currency: string },
    paymentIntent: Stripe.PaymentIntent
  ): Promise<void> {
    let transaction = await this.transactionRepository.findOne({
      where: { stripe_payment_intent_id: paymentIntent.id }
    });

    if (!transaction) {
      transaction = this.transactionRepository.create({
        customer_quiz_result_id: quizResult.id,
        customer_id: quizResult.customer_id,
        transaction_type: 'cross_sale',
        amount: product.amount.toString(),
        currency: product.currency,
        amount_gbp: await currencyRateService.convertToGbp(product.amount, product.currency),
        status: 'pending',
        stripe_payment_intent_id: paymentIntent.id
      });
    } else if (transaction.amount_gbp === null) {
      // This method is re-entered on repeat confirms. A row that predates the
      // rate table — or was written while it was empty — gets its GBP figure
      // filled in now rather than staying blank for ever.
      transaction.amount_gbp = await currencyRateService.convertToGbp(
        transaction.amount,
        transaction.currency
      );
    }

    switch (paymentIntent.status) {
      case 'succeeded':
        transaction.status = 'succeeded';
        break;
      case 'canceled':
        transaction.status = 'failed';
        break;
      default:
        transaction.status = 'pending';
    }

    transaction.stripe_charge_id =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id || transaction.stripe_charge_id || null;

    await this.transactionRepository.save(transaction);
  }

  /**
   * Resolve the one Stripe Customer for this person, creating it only as a last resort.
   *
   * Order: the id already on our customer row (verified to still exist in Stripe),
   * then a lookup by email so a record created elsewhere is reused, and only then
   * a brand new Customer. Whatever we end up with is written back to the customer
   * row, so the database and Stripe converge on a single id.
   */
  private async getOrCreateStripeCustomer(quizResult: CustomerQuizResult): Promise<string> {
    const stored = quizResult.customer?.stripe_customer_id;

    if (stored) {
      const verified = await this.stripeCustomerExists(stored);
      if (verified) {
        return stored;
      }
      logger.warn(
        `Stripe customer ${stored} on customer ${quizResult.customer_id} no longer exists — re-resolving`
      );
    }

    // Reuse a Customer that already exists in Stripe for this email
    try {
      const matches = await this.stripe.customers.list({ email: quizResult.email, limit: 1 });
      const found = matches.data[0];
      if (found && !found.deleted) {
        await this.persistStripeCustomerId(quizResult, found.id);
        return found.id;
      }
    } catch (err: any) {
      logger.warn(`Stripe customer lookup by email failed: ${err.message}`);
    }

    let stripeCustomer: Stripe.Customer;
    try {
      stripeCustomer = await this.stripe.customers.create({
        email: quizResult.email,
        metadata: { quiz_result_id: String(quizResult.id) }
      });
    } catch (err: any) {
      throw new AppError(`Payment provider error: ${err.message}`, 400);
    }

    await this.persistStripeCustomerId(quizResult, stripeCustomer.id);
    return stripeCustomer.id;
  }

  private async stripeCustomerExists(customerId: string): Promise<boolean> {
    try {
      const found = await this.stripe.customers.retrieve(customerId);
      return !(found as Stripe.DeletedCustomer).deleted;
    } catch {
      return false;
    }
  }

  /**
   * Write the Stripe customer id onto the customer row so it is never resolved twice.
   */
  private async persistStripeCustomerId(
    quizResult: CustomerQuizResult,
    stripeCustomerId: string
  ): Promise<void> {
    if (!quizResult.customer_id) {
      return;
    }

    const customer =
      quizResult.customer ??
      (await this.customerRepository.findOne({ where: { id: quizResult.customer_id } }));

    if (!customer || customer.stripe_customer_id === stripeCustomerId) {
      return;
    }

    customer.stripe_customer_id = stripeCustomerId;
    await this.customerRepository.save(customer);
    quizResult.customer = customer;
  }

  /**
   * Stripe Webhook Handler: confirms first sale, cross sale, and subscriptions
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    const startedAt = Date.now();
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.stripe.webhookSecret
      );
    } catch (err: any) {
      // Worth a row of its own. A rejected signature is either the wrong
      // STRIPE_WEBHOOK_SECRET for this environment — in which case *every*
      // payment silently stops reconciling and nothing else says so — or an
      // unsigned POST from someone who found the endpoint. Both are invisible
      // in the payment tables, because neither ever reaches them.
      await externalApiLogService.log({
        service_name: EXTERNAL_API_SERVICE.STRIPE_WEBHOOK,
        endpoint: 'signature_verification_failed',
        method: 'POST',
        status_code: 400,
        request_payload: {
          signature_header_present: Boolean(signature),
          body_bytes: rawBody?.length ?? 0
        },
        is_error: true,
        error_message: `Signature verification failed: ${err.message}`,
        duration_ms: Date.now() - startedAt
      });

      logger.error(`⚠️ Webhook signature verification failed: ${err.message}`);
      throw new AppError(`Webhook Error: ${err.message}`, 400);
    }

    logger.info(`Received Stripe Webhook Event: ${event.type} [${event.id}]`);

    try {
      await this.dispatchWebhookEvent(event);
    } catch (err: any) {
      // The handler failed after the event was accepted as genuine. Logged
      // before rethrowing, because the rethrow becomes a 500 and Stripe will
      // redeliver — so without this row the only trace of a repeatedly failing
      // event is a burst of identical 500s with no record of which event.
      await externalApiLogService.log({
        service_name: EXTERNAL_API_SERVICE.STRIPE_WEBHOOK,
        endpoint: event.type,
        method: 'POST',
        status_code: 500,
        request_payload: this.summarizeWebhookEvent(event),
        is_error: true,
        error_message: err?.message ?? String(err),
        duration_ms: Date.now() - startedAt
      });

      throw err;
    }

    await externalApiLogService.log({
      service_name: EXTERNAL_API_SERVICE.STRIPE_WEBHOOK,
      endpoint: event.type,
      method: 'POST',
      status_code: 200,
      request_payload: this.summarizeWebhookEvent(event),
      is_error: false,
      duration_ms: Date.now() - startedAt
    });

    return { received: true };
  }

  /**
   * What is kept from an event.
   *
   * Deliberately not the whole thing. Stripe keeps the full event retrievable by
   * its id, so copying an entire invoice into jsonb on every renewal buys table
   * size and nothing else. What is here is what the handlers below branch on,
   * which is what makes a row readable without a trip to the dashboard.
   */
  private summarizeWebhookEvent(event: Stripe.Event): Record<string, any> {
    const object = event.data?.object as Record<string, any> | undefined;
    const id = (value: any): string | null =>
      typeof value === 'string' ? value : (value?.id ?? null);

    return {
      event_id: event.id,
      type: event.type,
      livemode: event.livemode,
      api_version: event.api_version,
      created: event.created,
      object: object
        ? {
            id: object.id ?? null,
            object: object.object ?? null,
            status: object.status ?? null,
            // Invoices carry the figure under a different name to charges and
            // payment intents; whichever one is present is the money involved.
            amount: object.amount ?? object.amount_paid ?? object.amount_due ?? null,
            currency: object.currency ?? null,
            customer: id(object.customer),
            subscription: id(object.subscription),
            payment_intent: id(object.payment_intent),
            // Carries quiz_id and sale type — the link back to our own rows.
            metadata: object.metadata ?? null
          }
        : null
    };
  }

  /** Routes one verified event to its handler. */
  private async dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.handlePaymentIntentSucceeded(paymentIntent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.handlePaymentIntentFailed(paymentIntent);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await this.handleChargeRefunded(charge);
        break;
      }

      // Every renewal, and the first real charge when a trial converts, arrives
      // here. `payment_intent.succeeded` fires for the same money, but it carries
      // no subscription and no quiz reference, so it cannot open the row — the
      // invoice is the only event that can, and it is what the ledger is built on.
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaid(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaymentFailed(invoice);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(subscription);
        break;
      }

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Internal Webhook Handlers
   */
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { stripe_payment_intent_id: paymentIntent.id }
    });

    if (!transaction) {
      logger.warn(`No transaction found for PaymentIntent ${paymentIntent.id}`);
      return;
    }

    // Identical to what the confirm endpoints do, and idempotent, so a webhook that
    // arrives after the frontend already confirmed simply re-applies the same state.
    // This is also where the subscription is started for every customer whose
    // browser never came back to confirm it.
    const subscription = await this.settleTransactionFromIntent(transaction, paymentIntent);

    // Loud on purpose: a paid first sale with no plan is lost revenue, and this
    // log line is the only thing standing between that and silence.
    if (subscription && !subscription.created) {
      logger.error(
        `PaymentIntent ${paymentIntent.id}: first sale settled without a subscription — ${subscription.reason}`
      );
    }
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { stripe_payment_intent_id: paymentIntent.id }
    });

    if (transaction) {
      transaction.status = 'failed';
      await this.transactionRepository.save(transaction);
    }
  }

  private async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: [
        { stripe_charge_id: charge.id },
        { stripe_payment_intent_id: typeof charge.payment_intent === 'string' ? charge.payment_intent : undefined }
      ]
    });

    if (transaction) {
      transaction.status = 'refunded';
      transaction.refunded_at = new Date();
      transaction.refund_amount = (charge.amount_refunded / (transaction.currency === 'JPY' ? 1 : 100)).toString();
      await this.transactionRepository.save(transaction);
    }
  }

  /**
   * Bring one subscription fully back in step with Stripe: its status, its
   * billing period, and every charge it has ever taken.
   *
   * For repairing rows that went stale while the invoice events were unhandled
   * and the billing period was being read from a field Stripe had moved. Going
   * forward the webhooks keep both current, so this is a one-off catch-up rather
   * than something to run on a schedule.
   *
   * Idempotent: the period is simply overwritten with Stripe's answer, and each
   * invoice lands on its own row keyed by invoice id.
   */
  async resyncSubscription(
    stripeSubscriptionId: string
  ): Promise<{ found: boolean; invoicesLogged: number }> {
    const record = await this.syncSubscriptionFromStripe(stripeSubscriptionId);

    if (!record) {
      return { found: false, invoicesLogged: 0 };
    }

    let invoicesLogged = 0;

    // `autoPagingEach` rather than one page: a subscription billing every 28 days
    // passes Stripe's default page size inside a year.
    try {
      await this.stripe.invoices
        .list({ subscription: stripeSubscriptionId, limit: 100 })
        .autoPagingEach(async (invoice) => {
          if (!invoice.id) return;

          const amount = fromStripeAmount(invoice.amount_paid, invoice.currency);
          if (amount <= 0) return;

          const before = await this.transactionRepository.findOne({
            where: { stripe_invoice_id: invoice.id }
          });

          await this.recordSubscriptionTransaction(record, invoice, 'succeeded', amount);

          if (!before) invoicesLogged += 1;
        });
    } catch (err: any) {
      logger.warn(
        `Could not list invoices for subscription ${stripeSubscriptionId}: ${err.message}`
      );
    }

    return { found: true, invoicesLogged };
  }

  /**
   * A subscription invoice was paid — the first charge after the trial, or a renewal.
   *
   * This is the one place recurring money becomes a row in
   * `customer_quiz_result_payment_transactions`. Nothing else could do it:
   * `payment_intent.succeeded` fires for the same charge, but its PaymentIntent
   * was created by Stripe's billing engine, so no transaction row exists for it
   * to settle and it can only log "no transaction found" and give up — which is
   * exactly why every renewal was missing from the ledger.
   *
   * Also re-syncs the subscription itself. A renewal is precisely the moment the
   * billing period moves, and this event is guaranteed to fire when it does, so
   * the period is refreshed here as well as from `customer.subscription.updated`.
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    // Stripe types this as always present, but it is absent on an upcoming
    // invoice. Without the guard the idempotency lookup below would run with an
    // undefined id, which TypeORM answers with an arbitrary existing row.
    if (!invoice.id) {
      return;
    }

    const subscriptionId = readInvoiceSubscriptionId(invoice);

    if (!subscriptionId) {
      // A one-off invoice, not a membership charge. The funnel does not raise any.
      logger.info(`Invoice ${invoice.id}: not a subscription invoice, nothing to log`);
      return;
    }

    // Bring the subscription (and its new period) up to date first, so the row
    // this transaction hangs off is the right one even on the very first invoice,
    // where `customer.subscription.created` may not have landed yet.
    const record = await this.syncSubscriptionFromStripe(subscriptionId);

    if (!record) {
      logger.warn(
        `Invoice ${invoice.id}: no local subscription for ${subscriptionId} — charge not logged`
      );
      return;
    }

    // The opening invoice of a trial is for zero. Nothing was charged, so there is
    // no transaction to record; the real one arrives when the trial converts.
    const amount = fromStripeAmount(invoice.amount_paid, invoice.currency);
    if (amount <= 0) {
      logger.info(`Invoice ${invoice.id}: zero amount (trial opening invoice), nothing to log`);
      return;
    }

    await this.recordSubscriptionTransaction(record, invoice, 'succeeded', amount);
  }

  /**
   * A subscription invoice could not be collected — an expired or declined card.
   *
   * Logged as a failed transaction rather than dropped: without the row, a
   * membership that goes `past_due` has no explanation anywhere in our own data,
   * and support has to open Stripe to answer "why did my access stop?".
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // Stripe types this as always present, but it is absent on an upcoming
    // invoice. Without the guard the idempotency lookup below would run with an
    // undefined id, which TypeORM answers with an arbitrary existing row.
    if (!invoice.id) {
      return;
    }

    const subscriptionId = readInvoiceSubscriptionId(invoice);
    if (!subscriptionId) {
      return;
    }

    const record = await this.syncSubscriptionFromStripe(subscriptionId);
    if (!record) {
      logger.warn(
        `Invoice ${invoice.id}: no local subscription for ${subscriptionId} — failure not logged`
      );
      return;
    }

    const amount = fromStripeAmount(invoice.amount_due, invoice.currency);
    if (amount <= 0) {
      return;
    }

    await this.recordSubscriptionTransaction(record, invoice, 'failed', amount);
  }

  /**
   * Insert or update the `subscription` transaction for one invoice.
   *
   * Keyed on the invoice id, which is the only identifier every path shares:
   * `invoice.paid` and `invoice.payment_succeeded` both fire for the same money,
   * Stripe retries events, and an invoice that fails and is later collected
   * arrives twice by design. All of those have to land on one row.
   */
  private async recordSubscriptionTransaction(
    record: CustomerSubscription,
    invoice: Stripe.Invoice,
    status: 'succeeded' | 'failed',
    amount: number
  ): Promise<void> {
    const quizResultId = await this.quizResultIdForSubscription(record);

    if (!quizResultId) {
      // `customer_quiz_result_id` is NOT NULL — the ledger is keyed to the quiz
      // attempt that made the sale. A subscription with no attempt behind it is
      // not something the funnel creates, so this is a data problem worth seeing
      // rather than something to paper over with a placeholder row.
      logger.error(
        `Invoice ${invoice.id}: subscription ${record.stripe_subscription_id} has no quiz result — charge not logged`
      );
      return;
    }

    const currency = (invoice.currency || record.currency || 'jpy').toUpperCase();

    let transaction = await this.transactionRepository.findOne({
      where: { stripe_invoice_id: invoice.id }
    });

    if (!transaction) {
      transaction = this.transactionRepository.create({
        customer_quiz_result_id: quizResultId,
        customer_id: record.customer_id,
        transaction_type: 'subscription',
        amount: amount.toString(),
        currency,
        amount_gbp: await currencyRateService.convertToGbp(amount, currency),
        status,
        stripe_invoice_id: invoice.id
      });
    } else {
      // Never walk a succeeded row backwards: Stripe redelivers old events, and a
      // late `payment_failed` for an invoice that has since been collected must
      // not un-collect it in our ledger.
      if (transaction.status === 'succeeded' && status === 'failed') {
        return;
      }
      transaction.status = status;
      transaction.amount = amount.toString();
      transaction.currency = currency;
      if (transaction.amount_gbp === null) {
        transaction.amount_gbp = await currencyRateService.convertToGbp(amount, currency);
      }
    }

    const paymentIntentId = readInvoicePaymentIntentId(invoice);
    if (paymentIntentId) transaction.stripe_payment_intent_id = paymentIntentId;

    const chargeId = readInvoiceChargeId(invoice);
    if (chargeId) transaction.stripe_charge_id = chargeId;

    await this.transactionRepository.save(transaction);

    logger.info(
      `Subscription charge logged: invoice ${invoice.id} (${status}) ${amount} ${currency} ` +
        `for subscription ${record.stripe_subscription_id}`
    );
  }

  /**
   * The quiz attempt a subscription belongs to.
   *
   * The link is normally on the subscription row. Rows written before that
   * reference existed fall back to the customer's newest attempt, and the link is
   * backfilled so the lookup only happens once.
   */
  private async quizResultIdForSubscription(
    record: CustomerSubscription
  ): Promise<string | null> {
    if (record.customer_quiz_result_id) {
      return record.customer_quiz_result_id;
    }

    const quizResult = await this.quizResultRepository.findOne({
      where: { customer_id: record.customer_id },
      order: { id: 'DESC' }
    });

    if (!quizResult) {
      return null;
    }

    record.customer_quiz_result_id = quizResult.id;
    await this.subscriptionRepository.save(record);

    return quizResult.id;
  }

  /**
   * Re-read a subscription from Stripe and write it to our row, returning the row.
   *
   * Deliberately retrieves rather than trusting the invoice's expanded copy: the
   * retrieve goes through our pinned API version, so the billing period comes back
   * in the shape we expect no matter which version the webhook arrived in.
   */
  private async syncSubscriptionFromStripe(
    subscriptionId: string
  ): Promise<CustomerSubscription | null> {
    let subscription: Stripe.Subscription | null = null;

    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (err: any) {
      logger.warn(`Could not read subscription ${subscriptionId} from Stripe: ${err.message}`);
    }

    if (subscription) {
      const stripeCustomerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

      const customerId = await this.resolveCustomerIdForSubscription(
        subscription.id,
        stripeCustomerId
      );

      if (customerId) {
        await this.upsertSubscriptionRecord(
          subscription,
          customerId,
          subscription.metadata?.quiz_result_id || null
        );
      }
    }

    return this.subscriptionRepository.findOne({
      where: { stripe_subscription_id: subscriptionId }
    });
  }

  /**
   * Our customer id for a Stripe subscription.
   *
   * By the Stripe customer id first. Failing that, by a subscription row we
   * already hold — a customer whose `stripe_customer_id` was never written, or was
   * written against a different Stripe Customer, would otherwise have every one of
   * their subscription events dropped and never see their period update again.
   */
  private async resolveCustomerIdForSubscription(
    subscriptionId: string,
    stripeCustomerId: string
  ): Promise<string | null> {
    const customer = await this.customerRepository.findOne({
      where: { stripe_customer_id: stripeCustomerId }
    });

    if (customer) {
      return customer.id;
    }

    const existing = await this.subscriptionRepository.findOne({
      where: { stripe_subscription_id: subscriptionId }
    });

    if (existing) {
      return existing.customer_id;
    }

    logger.warn(
      `Subscription ${subscriptionId}: no customer found with stripe_customer_id ${stripeCustomerId}`
    );
    return null;
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const stripeCustomerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    const customerId = await this.resolveCustomerIdForSubscription(
      subscription.id,
      stripeCustomerId
    );

    if (!customerId) {
      return;
    }

    // Same upsert the first-sale flow uses, so a webhook arriving after we already
    // created the subscription simply refreshes it instead of duplicating. The quiz
    // reference rides along in metadata for subscriptions we created ourselves.
    const quizResultId = subscription.metadata?.quiz_result_id || null;
    await this.upsertSubscriptionRecord(subscription, customerId, quizResultId);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const subRecord = await this.subscriptionRepository.findOne({
      where: { stripe_subscription_id: subscription.id }
    });

    if (subRecord) {
      subRecord.status = 'canceled';
      subRecord.canceled_at = new Date();
      subRecord.cancel_reason = subscription.cancellation_details?.reason || 'User canceled';
      await this.subscriptionRepository.save(subRecord);
    }
  }
}

/* ── reading a Stripe Invoice across API versions ──────────────────────────────
 *
 * Webhooks are delivered in the Stripe *account's* default API version, not the
 * one the SDK is pinned to, so an invoice can arrive in either shape and the
 * code that reads it cannot assume which. Basil (2025-03-31) moved the
 * subscription reference under `parent.subscription_details`, replaced
 * `payment_intent` with a `payments` collection, and dropped `charge`
 * altogether. Each reader below tries the modern location first, then the
 * legacy one, so an account upgrade cannot silently stop the ledger.
 */

/** Zero-decimal currencies charge in whole units; everything else in hundredths. */
const ZERO_DECIMAL_CURRENCIES = new Set(['jpy', 'krw', 'vnd', 'clp', 'isk']);

function fromStripeAmount(smallestUnit: number | null | undefined, currency: string): number {
  if (typeof smallestUnit !== 'number' || !Number.isFinite(smallestUnit)) {
    return 0;
  }
  return ZERO_DECIMAL_CURRENCIES.has((currency || 'jpy').toLowerCase())
    ? smallestUnit
    : smallestUnit / 100;
}

const idOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && typeof (value as any).id === 'string') {
    return (value as any).id;
  }
  return null;
};

function readInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as any;
  return idOf(raw.parent?.subscription_details?.subscription) ?? idOf(raw.subscription);
}

function readInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as any;

  const direct = idOf(raw.payment_intent);
  if (direct) return direct;

  // Basil: one entry per collection attempt, newest last.
  const payments: any[] = raw.payments?.data ?? [];
  for (let i = payments.length - 1; i >= 0; i -= 1) {
    const found = idOf(payments[i]?.payment?.payment_intent);
    if (found) return found;
  }

  return null;
}

function readInvoiceChargeId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as any;
  return idOf(raw.charge) ?? idOf(raw.latest_charge);
}

export const paymentService = new PaymentService();
