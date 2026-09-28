import 'reflect-metadata';
import { createApp } from './app.js';
import { config, isLoopbackUrl } from './config/env.config.js';
import { AppDataSource } from './config/database.config.js';
import { logger } from './utils/logger.util.js';
import { startCurrencyRateCron, stopCurrencyRateCron } from './jobs/currency-rate.job.js';
import { startEmailMarketingCron, stopEmailMarketingCron } from './jobs/email-marketing.job.js';

/**
 * The settings that are only wrong once they are in someone's inbox.
 *
 * Everything else built from `APP_URL` is derived from the request or is a
 * development aid, so a stale value stayed invisible. An unsubscribe link is
 * not: it is printed into a message, delivered, and cannot be taken back. This
 * says so at boot, where somebody is watching, rather than in a log line three
 * weeks later.
 *
 * A warning and not a refusal to start. The API serving checkout is worth more
 * than the marketing sequence, and that sequence already holds itself back —
 * see the guard in email.service.ts — so the failure is contained either way.
 */
function warnAboutDeploymentUrls(): void {
  if (config.env !== 'production') return;

  if (isLoopbackUrl(config.appUrl)) {
    logger.error('────────────────────────────────────────────────────────');
    logger.error(`APP_URL is ${config.appUrl} on a production box.`);
    logger.error('Set it to the public origin of this API, e.g. https://api.myiq-test.com');
    logger.error('Until then, marketing email is held: its unsubscribe link');
    logger.error('would point at the machine the customer is reading on.');
    logger.error('────────────────────────────────────────────────────────');
  }

  // Same class of mistake, two variables along. Neither is fatal on its own,
  // and both produce links a customer cannot follow.
  for (const [name, value] of [
    ['FUNNEL_URL', config.funnelUrl],
    ['BOOST_APP_URL', config.boost.appUrl]
  ] as const) {
    if (isLoopbackUrl(value)) {
      logger.warn(`${name} is ${value} on a production box — links built from it will not resolve.`);
    }
  }
}

async function bootstrap() {
  try {
    warnAboutDeploymentUrls();

    // 1. Initialize Database Connection
    logger.info('Initializing PostgreSQL connection via TypeORM...');
    try {
      await AppDataSource.initialize();
      logger.info('Database connection established successfully.');
    } catch (dbError: any) {
      logger.warn(`Could not connect to database immediately: ${dbError.message}`);
      logger.warn('Server starting in standalone mode. Database queries will require active PostgreSQL connection.');
    }

    // 2. Schedule background jobs (each a no-op when disabled via env)
    startCurrencyRateCron();
    startEmailMarketingCron();

    // 3. Create and start Express application
    const app = createApp();
    const server = app.listen(config.port, () => {
      logger.info(`====================================================`);
      logger.info(`🚀 IQ Funnel Backend running on port ${config.port}`);
      logger.info(`   Environment: ${config.env}`);
      logger.info(`   API Root:    http://localhost:${config.port}`);
      logger.info(`====================================================`);
    });

    // 4. Graceful Shutdown Handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      await stopCurrencyRateCron();
      await stopEmailMarketingCron();
      server.close(async () => {
        if (AppDataSource.isInitialized) {
          await AppDataSource.destroy();
          logger.info('Database connection pool closed.');
        }
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Fatal error during application startup:', error);
    process.exit(1);
  }
}

bootstrap();
