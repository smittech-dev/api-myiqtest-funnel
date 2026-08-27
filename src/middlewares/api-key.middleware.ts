import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.config.js';

/**
 * API Key authentication middleware.
 * Validates the `x-api-key` header against the configured API_KEY.
 * Skips validation for the Stripe webhook endpoint (uses its own signature).
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Skip API key check for Stripe webhook — it has its own signature verification
  if (req.path === '/payment/webhook') {
    next();
    return;
  }

  // Admin panel routes carry their own bearer-token guard (adminAuth). They are
  // called from a browser bundle, so requiring the funnel's shared API key here
  // would mean shipping that key to every visitor — strictly worse than not
  // checking it. See src/middlewares/admin-auth.middleware.ts.
  if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    next();
    return;
  }

  // Skip if no API_KEY is configured (development convenience)
  if (!config.apiKey) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      success: false,
      error: { message: 'Missing API key. Provide it via the x-api-key header.' }
    });
    return;
  }

  if (apiKey !== config.apiKey) {
    res.status(403).json({
      success: false,
      error: { message: 'Invalid API key.' }
    });
    return;
  }

  next();
};
