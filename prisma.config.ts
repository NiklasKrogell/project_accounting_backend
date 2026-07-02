import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 configuration. The datasource connection URL for Prisma Migrate and
// other CLI commands lives here (it was removed from schema.prisma in v7). The
// application runtime connects separately via the pg driver adapter in
// src/lib/prisma.ts.
export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
