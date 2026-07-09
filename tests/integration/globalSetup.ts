import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from './testDb';

// Runs once before the integration test suite: creates the test database if it
// does not exist, applies migrations, and wipes all data so every run starts
// from a clean slate.
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

  execSync('npx prisma migrate deploy', {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });

  const db = new Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`
      TRUNCATE
        "JournalEntryLine", "Attachment", "JournalEntry", "VoucherCounter",
        "AccountingPeriod", "FiscalYear", "BankAccount", "Account",
        "AccountGroup", "Session", "VerificationToken", "CompanyUser",
        "Company", "User"
      CASCADE
    `);
  } finally {
    await db.end();
  }
}
