import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { BoostProfile } from '../entities/BoostProfile.entity.js';
import { ensureBoostProfile } from '../services/boost-profile.service.js';
import { logger } from '../utils/logger.util.js';

/**
 * Gives every existing paying customer a training profile.
 *
 *   npm run backfill:boost
 *
 * New purchases get one from the welcome email, and anyone who signs in gets
 * one on the spot — so this is not required for correctness. It is here so the
 * leaderboard and the admin views are complete from day one rather than filling
 * in as people happen to visit.
 *
 * Idempotent: customers who already have a profile are skipped, so it is safe
 * to run again after a partial run or a failure.
 */
async function backfill(): Promise<void> {
  await AppDataSource.initialize();

  const customerRepo = AppDataSource.getRepository(Customer);
  const profileRepo = AppDataSource.getRepository(BoostProfile);

  // `password_set_at` is what marks a real credential: the funnel seeds
  // password_hash with a throwaway sha256 at quiz submission, so selecting on
  // the hash would sweep in every visitor who ever took the test.
  const customers = await customerRepo
    .createQueryBuilder('c')
    .where('c.password_set_at IS NOT NULL')
    .orderBy('c.id', 'ASC')
    .getMany();

  const existing = new Set(
    (await profileRepo.find({ select: { customer_id: true } })).map((p) => p.customer_id)
  );

  let created = 0;
  let failed = 0;

  for (const customer of customers) {
    if (existing.has(customer.id)) continue;

    try {
      await ensureBoostProfile(customer);
      created += 1;
    } catch (error: any) {
      failed += 1;
      // One bad row must not abandon the rest of the run.
      logger.error(`Backfill failed for customer ${customer.id}: ${error?.message ?? error}`);
    }
  }

  logger.info(
    `Boost profile backfill complete — ${customers.length} paying customers, ` +
      `${created} created, ${customers.length - created - failed} already present, ${failed} failed.`
  );

  await AppDataSource.destroy();
}

backfill().catch((error) => {
  logger.error('Boost profile backfill did not complete:', error);
  process.exit(1);
});
