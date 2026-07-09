import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { acquireFiscalWriteLock } from '../lib/companyLock';

export const accountingPeriodService = {
  // The exclusive lock makes the close wait for in-flight journal-entry
  // bookings (which hold the shared lock), so no entry can slip into the
  // period while it is being closed.
  async closePeriod(companyId: string, periodId: string) {
    return prisma.$transaction(async (tx) => {
      await acquireFiscalWriteLock(tx, companyId);
      const period = await tx.accountingPeriod.findFirst({
        where: { id: periodId, companyId },
      });
      if (!period) throw AppError.notFound('Accounting period not found');
      if (period.status === 'CLOSED') {
        throw AppError.conflict('Accounting period is already closed');
      }
      return tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });
  },

  // A period can only be reopened while its fiscal year is open.
  async reopenPeriod(companyId: string, periodId: string) {
    return prisma.$transaction(async (tx) => {
      await acquireFiscalWriteLock(tx, companyId);
      const period = await tx.accountingPeriod.findFirst({
        where: { id: periodId, companyId },
        include: { fiscalYear: true },
      });
      if (!period) throw AppError.notFound('Accounting period not found');
      if (period.fiscalYear.status === 'CLOSED') {
        throw AppError.conflict('Reopen the fiscal year before reopening its periods');
      }
      if (period.status === 'OPEN') {
        throw AppError.conflict('Accounting period is already open');
      }
      return tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN', closedAt: null },
      });
    });
  },
};
