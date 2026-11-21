/**
 * A PostgreSQL server for local development, with nothing to install.
 *
 *   npm run db:local
 *
 * Downloads (once, via npm) and runs a real PostgreSQL binary, keeping its data
 * in `.local-db/` so it survives restarts. Leave it running in its own terminal
 * while the API runs in another; Ctrl+C stops it cleanly.
 *
 * Matches the defaults in `.env` for local work: port 5433 (so it never fights
 * a PostgreSQL you may already have on 5432), user `postgres`, password
 * `postgres`, database `iq_funnel_local`. Tables are created by the API itself
 * on boot, because the local `.env` sets DB_SYNCHRONIZE=true.
 *
 * Development only. It is never used by the server in production.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATA_DIR = resolve(process.cwd(), '.local-db');
const PORT = Number(process.env.LOCAL_DB_PORT || 5433);
const DATABASE = process.env.LOCAL_DB_NAME || 'iq_funnel_local';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  // UTF-8 and the C locale, whatever the machine's own locale is. Windows
  // otherwise initialises in its ANSI code page (WIN1252), which cannot store
  // Japanese — every name typed on the Personal Detail page would fail.
  initdbFlags: ['--encoding=UTF8', '--locale=C']
});

const firstRun = !existsSync(resolve(DATA_DIR, 'PG_VERSION'));
if (firstRun) {
  console.log(`Creating a new local database cluster in ${DATA_DIR} ...`);
  await pg.initialise();
}

await pg.start();

try {
  await pg.createDatabase(DATABASE);
  console.log(`Created database "${DATABASE}".`);
} catch {
  // Already there from an earlier run — the data is kept between runs.
}

console.log(
  `\nLocal PostgreSQL is running on localhost:${PORT} (database "${DATABASE}").` +
    '\nStart the API in another terminal with:  npm run dev' +
    '\nPress Ctrl+C here to stop the database.\n'
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping local PostgreSQL ...');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Keep the process alive for as long as the database should run.
setInterval(() => {}, 1 << 30);
