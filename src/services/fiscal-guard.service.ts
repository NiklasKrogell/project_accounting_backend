import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../lib/AppError';
import { normalizeToUtcDate } from '../lib/dateOnly';
import { acquireFiscalReadLock } from '../lib/companyLock';

// Booking guards for journal-entry services. Contract for entry CRUD:
// - Call the guard INSIDE the same prisma.$transaction that writes the entry,
//   passing that transaction client — the shared advisory lock it takes is
//   transaction-scoped and is what prevents a period from closing between the
//   check and the write.
// - Creating an entry:            assertDateBookable(companyId, date, tx)
// - Updating/deleting an entry:   assertEntryEditable(companyId, entry.date, tx)
// - Changing an entry's date:     assertEntryEditable(old) AND assertDateBookable(new)
// - Normalize entry dates to UTC midnight on write (see src/lib/dateOnly.ts).

async function resolvePeriod(companyId: string, date: Date, tx: Prisma.TransactionClient) {
  await acquireFiscalReadLock(tx, companyId);
  const day = normalizeToUtcDate(date);
  return tx.accountingPeriod.findFirst({
    where: { companyId, startDate: { lte: day }, endDate: { gte: day } },
    include: { fiscalYear: true },
  });
}

// Rejects unless `date` falls inside an existing OPEN fiscal year and an OPEN
// accounting period. Use for new bookings and as the target-date check when
// moving an entry.
export async function assertDateBookable(
  companyId: string,
  date: Date,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const period = await resolvePeriod(companyId, date, tx);
  if (!period) {
    throw AppError.badRequest('No fiscal year covers this date');
  }
  if (period.fiscalYear.status === 'CLOSED') {
    throw AppError.conflict('Fiscal year is closed');
  }
  if (period.status === 'CLOSED') {
    throw AppError.conflict('Accounting period is closed');
  }
}

// Same checks for mutating or deleting an EXISTING entry at its current date.
// Differs from assertDateBookable only for a date no fiscal year covers:
// such legacy entries are treated as locked (409), not as user input errors.
export async function assertEntryEditable(
  companyId: string,
  entryDate: Date,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const period = await resolvePeriod(companyId, entryDate, tx);
  if (!period) {
    throw AppError.conflict('Entry is locked: no fiscal year covers its date');
  }
  if (period.fiscalYear.status === 'CLOSED') {
    throw AppError.conflict('Fiscal year is closed');
  }
  if (period.status === 'CLOSED') {
    throw AppError.conflict('Accounting period is closed');
  }
}
