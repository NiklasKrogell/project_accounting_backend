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

// A second per-company lock, in a namespace of its own, serializes changes to
// who a company's members are and what they may do. Whoever takes it re-reads
// the memberships involved before applying the rules, so two company
// administrators acting on each other at the same moment can't both succeed
// and leave the company without one.
const MEMBERS_LOCK_NS = 0x4d454d42; // 'MEMB'

export async function acquireMembersLock(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${MEMBERS_LOCK_NS}::int, hashtext(${companyId}))::text`;
}
