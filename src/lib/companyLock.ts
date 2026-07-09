import type { Prisma } from '../generated/prisma/client';

// Per-company Postgres advisory locks that serialize fiscal-calendar changes
// (create/close/reopen/delete fiscal years and periods) against journal-entry
// bookings, without SERIALIZABLE isolation or retry loops:
// - calendar mutations take the exclusive lock;
// - the booking guard takes the shared lock, so concurrent bookings do not
//   block each other but a period close waits for in-flight bookings (and
//   vice versa) — an entry can never slip into a period mid-close.
// pg_advisory_xact_lock* locks are transaction-scoped: they must be taken
// inside a prisma.$transaction and release automatically on commit/rollback.
const LOCK_NS = 0x46495343; // 'FISC'

export async function acquireFiscalWriteLock(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  // ::text because the pg driver adapter cannot deserialize void columns.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK_NS}::int, hashtext(${companyId}))::text`;
}

export async function acquireFiscalReadLock(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(${LOCK_NS}::int, hashtext(${companyId}))::text`;
}
