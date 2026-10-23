import { Router } from 'express';
import { z } from 'zod';
import { CustomerController } from '../controllers/customer.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';

const router = Router();

const updateCustomerSchema = z.object({
  quiz_id: z.string().min(1, 'quiz_id is required'),
  first_name: z.string().min(1, 'first_name is required'),
  last_name: z.string().min(1, 'last_name is required'),
  age: z.string().min(1, 'age is required'),
  // Optional deliberately. The form has always made this required, so every
  // current browser sends it — but a customer part-way through the funnel on a
  // bundle cached from before it did must not be rejected at the one page they
  // are already stuck on. Length matches the column.
  gender: z.string().min(1).max(50).optional()
});

// PUT /customer/update
router.put(
  '/update',
  validateRequest({ body: updateCustomerSchema }),
  CustomerController.updateCustomer
);

export default router;
