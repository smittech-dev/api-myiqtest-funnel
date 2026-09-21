import { Router } from 'express';
import { BoostAuthController } from '../controllers/boost-auth.controller.js';
import { BoostAccountController } from '../controllers/boost-account.controller.js';
import { BoostQuizController } from '../controllers/boost-quiz.controller.js';
import { boostAuth, requireBoostSubscription } from '../middlewares/boost-auth.middleware.js';
import { boostErrorHandler } from '../middlewares/boost-error.middleware.js';
import {
  boostLoginLimiter,
  boostForgotPasswordLimiter,
  boostResetPasswordLimiter,
  boostAttemptLimiter,
  boostScoreLimiter,
  boostChangePasswordLimiter,
  boostEmailChangeLimiter,
  boostConfirmEmailLimiter
} from '../middlewares/boost-rate-limit.middleware.js';

/**
 * The members' area — Boost My IQ.
 *
 * Mounted at /boost-api/v1, which is what `VITE_API_BASE_URL` points at. It is
 * exempt from the funnel's `x-api-key` guard for the same reason /admin is:
 * this is called from a browser bundle, and a shared key shipped to every
 * visitor is not a secret. The bearer token below is the real guard.
 *
 * Three layers, in order:
 *   1. public   — sign in and password recovery
 *   2. boostAuth — a valid session; a cancelled member still gets this far
 *   3. requireBoostSubscription — a live membership, for training only
 *
 * The split at 2/3 matters: a cancelled member must still be able to sign in
 * and see their history and ranking. Gating the session itself would bounce
 * them to a login screen instead of the page offering to restart.
 */
const router = Router();

/* ── 1. public ────────────────────────────────────────────────────────────── */

router.post('/auth/login', boostLoginLimiter, BoostAuthController.login);
router.post('/auth/logout', BoostAuthController.logout);
router.post('/auth/forgot-password', boostForgotPasswordLimiter, BoostAuthController.forgotPassword);
router.post('/auth/reset-password', boostResetPasswordLimiter, BoostAuthController.resetPassword);

// Public, because the confirmation link is opened wherever the new address is
// read — often a different browser, often signed out. The token is the
// credential, so no session is required or expected.
router.post(
  '/auth/confirm-email',
  boostConfirmEmailLimiter,
  BoostAccountController.confirmEmailChange
);

/* ── 2. signed in ─────────────────────────────────────────────────────────── */

router.use(boostAuth);

router.get('/me', BoostAccountController.me);
router.patch('/me', BoostAccountController.updateMe);
router.post('/me/password', boostChangePasswordLimiter, BoostAccountController.changePassword);
router.post('/me/email', boostEmailChangeLimiter, BoostAccountController.requestEmailChange);
router.delete('/me/email', BoostAccountController.cancelEmailChange);
router.post('/me/deletion-request', BoostAccountController.requestDeletion);
router.get('/subscription', BoostAccountController.subscription);

// Managing the membership stays outside the training guard on purpose: a
// cancelled member must be able to restart, and a past_due one must be able to
// fix their card — both of which requireBoostSubscription would block.
router.post('/subscription/cancel', BoostAccountController.cancel);
router.post('/subscription/resume', BoostAccountController.resume);
router.post('/subscription/billing-portal', BoostAccountController.billingPortal);

// Readable without a live membership on purpose: a cancelled member keeps their
// scores, streak and ranking history — only training stops.
router.get('/dashboard', BoostQuizController.dashboard);
router.get('/boost', BoostQuizController.overview);
router.get('/leaderboard', BoostQuizController.leaderboard);
router.get('/reports', BoostQuizController.report);
router.get('/games', BoostQuizController.games);
router.get('/games/:slug', BoostQuizController.game);

/* ── 3. training — needs a live membership ────────────────────────────────── */

router.post('/boost/attempts', requireBoostSubscription, boostAttemptLimiter, BoostQuizController.start);
router.get('/boost/attempts/current', requireBoostSubscription, BoostQuizController.current);
router.get('/boost/attempts/:id', requireBoostSubscription, BoostQuizController.byId);
router.patch('/boost/attempts/:id/progress', requireBoostSubscription, BoostQuizController.progress);
router.post('/boost/attempts/:id/submit', requireBoostSubscription, BoostQuizController.submit);

// Playing a game is training, so it needs a live membership. This is the one
// endpoint where a member supplies a number that feeds their own points, so it
// is both rate limited and bounded per game.
router.post(
  '/games/:slug/score',
  requireBoostSubscription,
  boostScoreLimiter,
  BoostQuizController.submitScore
);

/* ── unknown paths and errors, in this module's own shape ─────────────────── */

router.use((req, res) => {
  res.status(404).json({
    code: 'not_found',
    message: `No such endpoint: ${req.method} ${req.originalUrl}`
  });
});

router.use(boostErrorHandler);

export default router;
