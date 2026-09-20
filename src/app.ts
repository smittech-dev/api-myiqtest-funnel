import path from 'path';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import routes from './routes/index.js';
import boostRoutes from './routes/boost.routes.js';
import { swaggerSpec, swaggerSpecFor } from './config/swagger.config.js';
import { config } from './config/env.config.js';
import { requestLogger } from './middlewares/request-logger.middleware.js';
import { apiKeyAuth } from './middlewares/api-key.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';

export function createApp(): Express {
  const app = express();

  // In production the app sits behind a TLS-terminating proxy, which speaks
  // plain HTTP to us. Without this, `req.protocol` reports that inner hop
  // rather than what the client used, and every request-derived URL — the
  // Swagger server list most visibly — comes out `http://` on an HTTPS site.
  // Left off elsewhere: trusting `X-Forwarded-*` from a directly-reachable
  // process lets any caller dictate its own apparent protocol and IP.
  if (config.env === 'production') {
    app.set('trust proxy', true);
  }

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
  // Two different CORS contracts in one service.
  //
  // The funnel is called from pages that send no credentials, so `*` is both
  // sufficient and simplest. The members' app sends `credentials: 'include'` on
  // every request, and a browser refuses a credentialed response that carries
  // `Access-Control-Allow-Origin: *` — so those origins have to be named
  // explicitly, and named ones are the only ones that get `credentials: true`.
  //
  // An unknown origin therefore falls back to the funnel's permissive rule and
  // simply cannot use credentials, rather than being blocked outright.
  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      const isMemberApp = Boolean(origin && config.boost.appOrigins.includes(origin));

      callback(null, {
        origin: isMemberApp ? origin : '*',
        credentials: isMemberApp,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature', 'x-api-key']
      });
    })
  );

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
  // `swaggerSpecFor` rebuilds the server list from the request, and
  // swagger-ui-express renders `req.swaggerDoc` in preference to the spec it
  // was set up with — so the page is built per request and "Try it out" targets
  // the host the docs were actually opened on, not whatever APP_URL happens to
  // say. `swaggerSpec` is still passed as the fallback for the same reason it
  // still has a static `servers` entry.
  app.use(
    '/docs',
    swaggerUi.serve,
    (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { swaggerDoc?: unknown }).swaggerDoc = swaggerSpecFor(req);
      next();
    },
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'IQ Funnel API Docs',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true }
    })
  );
  app.get('/docs.json', (req: Request, res: Response) => {
    res.json(swaggerSpecFor(req));
  });

  // Static funnel test harness (development aid; mounted before apiKeyAuth so the
  // page itself loads without a key — its fetch calls still send one).
  if (config.demoEnabled) {
    app.get('/app/config.js', (req: Request, res: Response) => {
      res.type('application/javascript').send(
        `window.APP_CONFIG = ${JSON.stringify({
          // Same reasoning as the Swagger server list: the harness is served by
          // this process, so the origin it was fetched from is the API — and
          // deriving it beats an APP_URL that is still the local default on a
          // deployed box, which pointed the page's fetch calls at the reader's
          // own machine. Falls back to APP_URL if there is no Host to read.
          apiBase: req.get('host') ? `${req.protocol}://${req.get('host')}` : config.appUrl,
          port: config.port,
          stripePublishableKey: config.stripe.publishableKey,
          // Deliberately only a boolean — never ship the actual key to the browser
          apiKeyRequired: Boolean(config.apiKey)
        })};`
      );
    });
    app.use('/app', express.static(path.resolve(process.cwd(), 'public')));
  }

  // The members' area. Mounted before apiKeyAuth because it is called from a
  // browser bundle: shipping the funnel's shared key to every visitor would
  // publish it, which is strictly worse than not checking it. These routes
  // carry their own bearer-token guard — see src/routes/boost.routes.ts.
  app.use('/boost-api/v1', boostRoutes);

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
