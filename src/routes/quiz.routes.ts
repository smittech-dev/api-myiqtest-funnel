import { Router } from 'express';
import { z } from 'zod';
import { QuizController } from '../controllers/quiz.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';

const router = Router();

const submitQuizSchema = z.object({
  email: z.string().email(),
  iq_score: z.number().int().min(40).max(200),
  // The instrument's own subtests, by key: visual (Visual Reasoning), insight
  // (Visual Insight) and numerical (Numerical Reasoning). Left as a free-form
  // record rather than a fixed shape so the item bank can gain or rename a
  // subtest without a schema change breaking every submit — the column stores
  // it as an opaque JSON blob either way, and the report reads it back as one.
  category_scores: z.record(z.number()).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  landing_url_details: z.object({
    landing_url: z.string().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    referrer: z.string().optional()
  }).optional()
});

const quizResultsQuerySchema = z.object({
  quiz_id: z.string().min(1, 'quiz_id query parameter is required')
});

// POST /questions/submit
router.post(
  '/submit',
  validateRequest({ body: submitQuizSchema }),
  QuizController.submitQuiz
);

// GET /questions/results?quiz_id=<encrypted_quiz_id>
router.get(
  '/results',
  validateRequest({ query: quizResultsQuerySchema }),
  QuizController.getQuizResults
);

// GET /questions/report?quiz_id=<encrypted_quiz_id>
// Everything the thank-you page needs in one call: the customer, the scored
// quiz, which of the two reports have been paid for, and where the funnel
// says this customer belongs.
router.get(
  '/report',
  validateRequest({ query: quizResultsQuerySchema }),
  QuizController.getQuizReport
);

export default router;
