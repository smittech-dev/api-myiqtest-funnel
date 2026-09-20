import Stripe from 'stripe';
import { config } from '../config/env.config.js';
import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { CustomerQuizResultPaymentTransaction } from '../entities/CustomerQuizResultPaymentTransaction.entity.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerSubscription } from '../entities/CustomerSubscription.entity.js';
import { currencyRateService } from './currency-rate.service.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { getPricingByLanguage, applyDiscount, resolveDiscountCode } from '../constants/pricing.constants.js';
import { emailTransactionalService } from './email-transactional.service.js';
import { logger } from '../utils/logger.util.js';
import { resolveFunnelRedirect, FunnelRedirect } from '../utils/funnel-redirect.util.js';

export interface SubscriptionOutcome {
  created: boolean;
  subscription_id: string | null;
  status: string | null;
  /** Why no subscription was started, when created is false. */
  reason: string | null;
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
    this.stripe = new Stripe(config.stripe.secretKey, {
      apiVersion: '2025-02-24.acacia' as any
    });
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
        description: product.title,
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
        subscription: await this.existingSubscriptionOutcome(quizResult)
      };
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripe.paymentIntents.retrieve(payment_intent_id);
    } catch (err: any) {
      logger.error(`Could not read PaymentIntent ${payment_intent_id}: ${err.message}`);
      throw new AppError(`Could not read the payment from Stripe: ${err.message}`, 502);
    }

    await this.settleTransactionFromIntent(transaction, paymentIntent);

    // Remember the card on the quiz result so later charges (cross-sale, subscription)
    // read it from our own database instead of calling Stripe again.
    await this.storePaymentMethodOnQuiz(quizResult, paymentIntent);

    // Start the recurring plan on the card just used. Deliberately best-effort:
    // the customer has already been charged for the first sale, so a subscription
    // problem must never fail this request or strand the funnel.
    const subscription =
      paymentIntent.status === 'succeeded'
        ? await this.startSubscription(quizResult, paymentIntent)
        : { created: false, subscription_id: null, status: null, reason: 'first sale not paid' };

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
    const skip = (reason: string): SubscriptionOutcome => ({
      created: false,
      subscription_id: null,
      status: null,
      reason
    });

    try {
      if (!config.subscription.enabled) {
        return skip('subscriptions disabled (SUBSCRIPTION_ENABLED=false)');
      }

      const plan = getPricingByLanguage(quizResult.language).subscription;
      if (!plan.price_id) {
        logger.warn(
          `Subscription skipped for quiz ${quizResult.id}: no Stripe Price id configured for language "${quizResult.language}"`
        );
        return skip('no Stripe Price id configured for this language');
      }

      if (!quizResult.customer_id) {
        return skip('quiz result has no customer record');
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
        return skip('the first sale did not save a reusable card');
      }

      // Make the saved card the default for future invoices
      await this.stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId }
      });

      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: plan.price_id }],
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
      return skip(`subscription could not be created: ${err.message}`);
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

    const periodStart = (subscription as any).current_period_start;
    const periodEnd = (subscription as any).current_period_end;

    if (!record) {
      record = this.subscriptionRepository.create({
        customer_id: customerId,
        customer_quiz_result_id: quizResultId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: stripeCustomerId,
        status: subscription.status,
        plan_name: item?.price?.nickname || 'IQ Brain Training',
        amount: amount.toString(),
        currency: (item?.price?.currency || 'jpy').toUpperCase(),
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        current_period_start: periodStart ? new Date(periodStart * 1000) : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000) : null
      });
    } else {
      record.status = subscription.status;
      // A membership cancelled from the members' area, or from Stripe's billing
      // portal, stays `active` until its period runs out — this flag is the only
      // thing that distinguishes "cancelling on the 18th" from "renewing on the
      // 18th", so it has to ride along with the status it qualifies.
      record.cancel_at_period_end = Boolean(subscription.cancel_at_period_end);
      if (periodStart) record.current_period_start = new Date(periodStart * 1000);
      if (periodEnd) record.current_period_end = new Date(periodEnd * 1000);
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

    await this.subscriptionRepository.save(record);
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
   * Map a PaymentIntent status onto a stored transaction and activate the customer
   * on success. Shared by the confirm endpoints and the webhook so both settle
   * identically no matter which arrives first.
   *
   * Also the single place the welcome email is triggered from — precisely
   * because both paths run through here, and the email must be sent once no
   * matter which of them wins the race.
   */
  private async settleTransactionFromIntent(
    transaction: CustomerQuizResultPaymentTransaction,
    paymentIntent: Stripe.PaymentIntent
  ): Promise<void> {
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

    if (paymentIntent.status !== 'succeeded' || !transaction.customer_id) {
      return;
    }

    // Activate the account. The welcome email below issues its password, so
    // from this point the customer can actually sign in to the training program.
    const customer = await this.customerRepository.findOne({
      where: { id: transaction.customer_id }
    });

    if (!customer) {
      return;
    }

    customer.status = 'active';
    if (typeof paymentIntent.customer === 'string') {
      customer.stripe_customer_id = paymentIntent.customer;
    }
    await this.customerRepository.save(customer);

    // The welcome email, with the customer's brain training credentials.
    //
    // Only for the first sale: this method settles cross-sale and subscription
    // intents too, and those are not a new account.
    //
    // Deliberately not awaited. The customer's money has already moved, and a
    // slow or unhappy email provider must not delay a confirm response or push
    // a Stripe webhook towards its timeout — which would have Stripe retry the
    // event and settle it all over again. The service claims a dedup row before
    // it sends, so the retry that this protects against could not double-send
    // anyway, and every failure inside it is caught and logged.
    if (transaction.transaction_type === 'first_sale') {
      void emailTransactionalService
        .sendWelcome(transaction.customer_quiz_result_id)
        .catch((err) => logger.error(`Welcome email dispatch failed: ${err?.message ?? err}`));
    }
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
        description: product.title,
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
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.stripe.webhookSecret
      );
    } catch (err: any) {
      logger.error(`⚠️ Webhook signature verification failed: ${err.message}`);
      throw new AppError(`Webhook Error: ${err.message}`, 400);
    }

    logger.info(`Received Stripe Webhook Event: ${event.type} [${event.id}]`);

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

    return { received: true };
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
    await this.settleTransactionFromIntent(transaction, paymentIntent);
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

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    
    // Find customer by stripe_customer_id or metadata
    const customer = await this.customerRepository.findOne({
      where: { stripe_customer_id: stripeCustomerId }
    });

    if (!customer) {
      logger.warn(`Subscription ${subscription.id}: No customer found with stripe_customer_id ${stripeCustomerId}`);
      return;
    }

    // Same upsert the first-sale flow uses, so a webhook arriving after we already
    // created the subscription simply refreshes it instead of duplicating. The quiz
    // reference rides along in metadata for subscriptions we created ourselves.
    const quizResultId = subscription.metadata?.quiz_result_id || null;
    await this.upsertSubscriptionRecord(subscription, customer.id, quizResultId);
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

export const paymentService = new PaymentService();
