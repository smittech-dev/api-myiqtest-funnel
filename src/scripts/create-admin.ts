/**
 * Provisions an admin user. There is no registration endpoint by design, so
 * accounts are created here, on the server.
 *
 *   npm run create:admin -- --name "Jane" --email jane@example.com --password "s3cret!"
 *
 * Re-running with an existing email resets that admin's password instead of
 * failing, which doubles as the password-reset path the panel does not expose.
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { adminAuthService } from '../services/admin-auth.service.js';
import { logger } from '../utils/logger.util.js';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const name = readArg('--name');
  const email = readArg('--email');
  const password = readArg('--password');
  const reset = process.argv.includes('--reset');

  if (!email || !password || (!name && !reset)) {
    console.error(
      [
        'Usage:',
        '  npm run create:admin -- --name "Jane Doe" --email jane@example.com --password "s3cret!"',
        '  npm run create:admin -- --reset --email jane@example.com --password "newpass"',
        '',
        'Password must be at least 8 characters.'
      ].join('\n')
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  await AppDataSource.initialize();
  logger.info('Database connection established.');

  try {
    if (reset) {
      const user = await adminAuthService.setPassword(email, password);
      logger.info(`Password reset for admin ${user.email} (id ${user.id}).`);
    } else {
      const user = await adminAuthService.createAdmin(name!, email, password);
      logger.info(`Admin created: ${user.email} (id ${user.id}, role ${user.role}).`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  logger.error('Failed to provision admin:', error?.message ?? error);
  process.exit(1);
});
