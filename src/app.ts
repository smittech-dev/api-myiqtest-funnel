import path from 'path';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import routes from './routes/index.js';
import { swaggerSpec } from './config/swagger.config.js';
import { config } from './config/env.config.js';
import { requestLogger } from './middlewares/request-logger.middleware.js';
import { apiKeyAuth } from './middlewares/api-key.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';

export function createApp(): Express {
  const app = express();

  // Security & Utility Middlewares
  // Helmet's default CSP blocks Swagger UI's inline bootstrap script and the
  // Stripe.js/iframe loads the /app test harness needs, so skip it on those two paths.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/docs') || req.path.startsWith('/app')) {
      next();
      return;
    }
    helmet()(req, res, next);
  });
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature', 'x-api-key']
  }));

  // Handle raw body specifically for Stripe webhook signature verification
  app.use(
    '/payment/webhook',
    express.raw({ type: 'application/json' })
  );

  // Standard JSON and URL-encoded parsers for all other routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // API Documentation (mounted before apiKeyAuth so the docs stay reachable)
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'IQ Funnel API Docs',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true }
    })
  );
  app.get('/docs.json', (_req: Request, res: Response) => {
    res.json(swaggerSpec);
  });

  // Static funnel test harness (development aid; mounted before apiKeyAuth so the
  // page itself loads without a key — its fetch calls still send one).
  if (config.demoEnabled) {
    app.get('/app/config.js', (_req: Request, res: Response) => {
      res.type('application/javascript').send(
        `window.APP_CONFIG = ${JSON.stringify({
          apiBase: config.appUrl,
          port: config.port,
          stripePublishableKey: config.stripe.publishableKey,
          // Deliberately only a boolean — never ship the actual key to the browser
          apiKeyRequired: Boolean(config.apiKey)
        })};`
      );
    });
    app.use('/app', express.static(path.resolve(process.cwd(), 'public')));
  }

  // API Key authentication (skips webhook — it uses Stripe signature)
  app.use(apiKeyAuth);

  // Mount Routes directly at root
  app.use('/', routes);

  // 404 Route Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        message: `Endpoint ${req.method} ${req.originalUrl} not found`
      }
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
