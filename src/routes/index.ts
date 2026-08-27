import { Router } from 'express';
import quizRoutes from './quiz.routes.js';
import pricingRoutes from './pricing.routes.js';
import paymentRoutes from './payment.routes.js';
import customerRoutes from './customer.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

// Health Check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Funnel Endpoints
router.use('/questions', quizRoutes);
router.use('/price', pricingRoutes);
router.use('/payment', paymentRoutes);
router.use('/customer', customerRoutes);

// Admin Panel Endpoints (guarded by the admin JWT, not the funnel API key)
router.use('/admin', adminRoutes);

export default router;
