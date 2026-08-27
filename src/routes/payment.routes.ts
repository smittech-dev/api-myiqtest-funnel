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
    )
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

// POST /payment/webhook
router.post(
  '/webhook',
  PaymentController.handleWebhook
);

export default router;
