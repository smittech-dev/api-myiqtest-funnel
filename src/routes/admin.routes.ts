import { Router } from 'express';
import { z } from 'zod';
import { AdminAuthController } from '../controllers/admin-auth.controller.js';
import { AdminDashboardController } from '../controllers/admin-dashboard.controller.js';
import { AdminCurrencyController } from '../controllers/admin-currency.controller.js';
import { AdminEmailMarketingController } from '../controllers/admin-email-marketing.controller.js';
import { AdminQuizController } from '../controllers/admin-quiz.controller.js';
import { adminAuth } from '../middlewares/admin-auth.middleware.js';
import { validateRequest } from '../middlewares/validation.middleware.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required')
});

// Accepts YYYY-MM-DD or a full ISO timestamp; parseDateRange does the widening.
const dateFilter = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Must be YYYY-MM-DD or an ISO timestamp')
  .optional();

const dateRangeSchema = z.object({
  from: dateFilter,
  to: dateFilter
});

const quizListSchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z
    .enum(['all', 'first_sale', 'cross_sale', 'subscription', 'no_purchase'])
    .optional(),
  language: z.enum(['all', 'ja', 'en']).optional(),
  from: dateFilter,
  to: dateFilter,
  page: z.coerce.number().int().min(1).default(1),
  // Capped so a caller cannot ask for the whole table in one response.
  page_size: z.coerce.number().int().min(1).max(100).default(10)
});

const quizIdSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Quiz id must be numeric')
});

const emailMarketingLogSchema = z.object({
  step_key: z.string().trim().max(50).optional(),
  status: z.enum(['all', 'pending', 'sent', 'failed', 'skipped']).optional(),
  search: z.string().trim().max(255).optional(),
  from: dateFilter,
  to: dateFilter,
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20)
});

const emailTestSendSchema = z.object({
  template_id: z.string().trim().min(1).max(100),
  to: z.string().email('A valid recipient address is required'),
  language: z.enum(['ja', 'en']).default('ja'),
  // Optional: a design can be previewed without a discount panel.
  discount_code: z.string().trim().max(50).optional()
});

// ---------------------------------------------------------------------------
// Public: the only admin route reachable without a token.
// ---------------------------------------------------------------------------
router.post('/auth/login', validateRequest({ body: loginSchema }), AdminAuthController.login);

// ---------------------------------------------------------------------------
// Everything below requires a valid admin bearer token.
// ---------------------------------------------------------------------------
router.use(adminAuth);

router.get('/auth/me', AdminAuthController.me);
router.post('/auth/logout', AdminAuthController.logout);

router.get(
  '/dashboard/stats',
  validateRequest({ query: dateRangeSchema }),
  AdminDashboardController.getStats
);

router.get(
  '/quiz-submissions',
  validateRequest({ query: quizListSchema }),
  AdminQuizController.list
);

router.get(
  '/quiz-submissions/:id',
  validateRequest({ params: quizIdSchema }),
  AdminQuizController.detail
);

// POST /admin/currency-rates/sync
// Runs the same refresh as the twelve-hourly cron, on demand. No body and no
// parameters: the refresh stores every currency the provider returns, so there
// is nothing for a caller to choose.
router.post('/currency-rates/sync', AdminCurrencyController.sync);

// ---------------------------------------------------------------------------
// Email marketing
//
// The config body is deliberately not validated here. Its schema lives in
// services/email-marketing-settings.service.ts alongside the tables it writes,
// so every path into those tables is held to identical rules — including that a
// referenced template and discount code actually exist.
// ---------------------------------------------------------------------------
router.get('/email-marketing/config', AdminEmailMarketingController.getConfig);
router.put('/email-marketing/config', AdminEmailMarketingController.saveConfig);

router.get(
  '/email-marketing/logs',
  validateRequest({ query: emailMarketingLogSchema }),
  AdminEmailMarketingController.listLogs
);

router.get(
  '/email-marketing/stats',
  validateRequest({ query: dateRangeSchema }),
  AdminEmailMarketingController.getStats
);

// Runs the same pass as the five-minute cron, on demand.
router.post('/email-marketing/run', AdminEmailMarketingController.run);

router.post(
  '/email-marketing/test-send',
  validateRequest({ body: emailTestSendSchema }),
  AdminEmailMarketingController.testSend
);

export default router;
