/**
 * Applies database migrations (used when the production container starts).
 *
 *   node dist/cli/migrate.js
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
await migrate(drizzle({ client: pool }), { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
await pool.end();
console.log('migrations applied');
