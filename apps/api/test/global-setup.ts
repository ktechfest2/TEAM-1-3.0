import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** The database end-to-end tests use: never the development or production database. */
export function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://trustelect:trustelect_local_only@localhost:5442/trustelect');
  url.pathname = '/trustelect_test';
  return url.toString();
}

/** Creates the test database if needed and brings it up to the latest migration. */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error(`Refusing to run tests against "${name}": the name must end in _test`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (!rowCount) await client.query(`create database "${name}"`);
  await client.end();

  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
  await pool.end();
}
