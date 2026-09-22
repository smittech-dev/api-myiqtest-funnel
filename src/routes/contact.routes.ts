import { Router } from 'express';
import { z } from 'zod';
import { ContactController } from '../controllers/contact.controller.js';
import { contactLimiter } from '../middlewares/contact-rate-limit.middleware.js';
import { validateRequest } from '../middlewares/validation.middleware.js';

const router = Router();

/**
 * Mirrors the funnel form's own validation, and is the copy that counts — the
 * client's is a courtesy to the person typing, not a control.
 *
 * `topic` is an enum rather than free text so the admin panel can filter on it
 * and translate it; anything else would make the column a dumping ground.
 */
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Your name is required').max(255),
  email: z.string().trim().email('A valid email address is required').max(255),
  topic: z.enum(['billing', 'results', 'technical', 'press', 'other']).default('other'),
  message: z
    .string()
    .trim()
    .min(10, 'Please write a message of at least ten characters')
    // A contact form is not a file upload. Long enough for a real complaint,
    // short enough that one submission cannot be a payload.
    .max(5000, 'Please keep your message under 5000 characters'),
  language: z.enum(['ja', 'en']).default('ja')
});

// POST /contact
router.post(
  '/',
  contactLimiter,
  validateRequest({ body: contactSchema }),
  ContactController.submit
);

export default router;
