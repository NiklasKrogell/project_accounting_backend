// Single source of truth for the integration-test database URL. Defaults to a
// dedicated database in the local dev Postgres container (port 5433); CI
// overrides via TEST_DATABASE_URL.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/project_accounting_test';
