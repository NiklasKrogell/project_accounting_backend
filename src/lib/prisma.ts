import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

// Prisma 7 connects to the database through a driver adapter rather than the
// old bundled query engine. We build a single PrismaClient (backed by the pg
// adapter) and reuse it across the process. Under nodemon/ts-node the module can
// be re-evaluated on reload, so the instance is stashed on globalThis to avoid
// exhausting the connection pool with duplicate clients.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
