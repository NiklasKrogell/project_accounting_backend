import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        // Integration tests run against a dedicated test database
        // (tests/integration/testDb.ts) that globalSetup provisions; files run
        // sequentially because they share that database.
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['./tests/integration/globalSetup.ts'],
          setupFiles: ['./tests/integration/setupEnv.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
