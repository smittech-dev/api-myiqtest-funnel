import { Router } from 'express';
import { z } from 'zod';
import { PaymentController } from '../controllers/payment.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { resolveDiscountCode, DISCOUNT_CODES } from '../constants/pricing.constants.js';

const router = Router();

const paymentIntentSchema = z.object({
  quiz_id: z.string().min(1, 'quiz_id is required'),
  language: z.enum(['ja', 'en']).optional()
});

// Only the first sale is discountable
const firstSaleIntentSchema = paymentIntentSchema.extend({
  // Discount code, plain or personalised (xx_CODE) — never a percentage
  price_dis: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || v === '' || resolveDiscountCode(v) !== null,
      `price_dis must be a valid discount code (configured: ${DISCOUNT_CODES.join(', ')}), optionally prefixed with two email letters and an underscore`
    ),
  // A card payment: the address typed beside the card form. Applied before the
  // intent is created, so the payment, the Stripe Customer and the
  // subscription all belong to the real person from the start.
  email: z.string().trim().email().max(255).optional(),
  // An Apple Pay / Google Pay payment: the address the wallet handed over.
  // Held back, not applied — the Personal Detail page may supply a better one,
  // and the replacement job applies this only if it does not.
  wallet_email: z.string().trim().email().max(255).optional()
});

const firstSaleConfirmSchema = z.object({
  quiz_id: z.string().min(1, 'quiz_id is required'),
  payment_intent_id: z.string().min(1, 'payment_intent_id is required')
});

// POST /payment/first-sale/create-payment-intent
router.post(
  '/first-sale/create-payment-intent',
  validateRequest({ body: firstSaleIntentSchema }),
  PaymentController.createFirstSalePaymentIntent
);

// POST /payment/first-sale/payments/confirm
// Called by the frontend as soon as Stripe.js reports success, so the funnel
// advances without waiting for the (possibly delayed) webhook.
router.post(
  '/first-sale/payments/confirm',
  validateRequest({ body: firstSaleConfirmSchema }),
  PaymentController.confirmFirstSalePayment
);

// POST /payment/cross-sale/confirm
// No payment sheet: charges the card saved during the first sale, off-session.
router.post(
  '/cross-sale/confirm',
  validateRequest({ body: paymentIntentSchema }),
  PaymentController.confirmCrossSalePayment
);

// POST /payment/cross-sale/decline
// The upsell was turned down. Recorded so the customer is not sent back to it,
// and because it settles the report — the report-ready email goes out now.
router.post(
  '/cross-sale/decline',
  validateRequest({ body: paymentIntentSchema.pick({ quiz_id: true }) }),
  PaymentController.declineCrossSale
);

// POST /payment/webhook
router.post(
  '/webhook',
  PaymentController.handleWebhook
);

export default router;
