import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from './testDb';

// Runs once before the integration test suite. Provisions a disposable test
// database from a clean slate: create it if missing, drop and recreate the
// public schema so every migration applies to empty tables, then apply
// migrations. Resetting the schema (rather than truncating afterwards) keeps
// the harness robust against schema-changing migrations and needs no
// per-table maintenance.
export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  const db = new Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await db.end();
  }

  execSync('npx prisma migrate deploy', {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
