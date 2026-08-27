import 'reflect-metadata';
import { createApp } from './app.js';
import { config } from './config/env.config.js';
import { AppDataSource } from './config/database.config.js';
import { logger } from './utils/logger.util.js';
import { startCurrencyRateCron, stopCurrencyRateCron } from './jobs/currency-rate.job.js';
import { startEmailMarketingCron, stopEmailMarketingCron } from './jobs/email-marketing.job.js';

async function bootstrap() {
  try {
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
