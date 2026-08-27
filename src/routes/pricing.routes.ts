import { Router } from 'express';
import { z } from 'zod';
import { PricingController } from '../controllers/pricing.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { resolveDiscountCode, DISCOUNT_CODES } from '../constants/pricing.constants.js';

const router = Router();

const priceQuerySchema = z.object({
  language: z.enum(['ja', 'en']).optional(),
  lang: z.enum(['ja', 'en']).optional(),
  // Accepts a plain code or a personalised one (xx_CODE)
  price_dis: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || v === '' || resolveDiscountCode(v) !== null,
      `price_dis must be a valid discount code (configured: ${DISCOUNT_CODES.join(', ')}), optionally prefixed with two email letters and an underscore`
    )
});

// GET /price?language=ja&price_dis=20
router.get('/', validateRequest({ query: priceQuerySchema }), PricingController.getPrice);

export default router;
