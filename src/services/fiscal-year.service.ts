import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { addDays } from '../lib/dateOnly';
import { generatePeriods, validateFiscalYearLength } from '../lib/periodGeneration';
import type { PeriodGranularity } from '../lib/periodGeneration';
import { acquireFiscalWriteLock } from '../lib/companyLock';

const periodsAsc = { periods: { orderBy: { index: 'asc' as const } } };

export interface CreateFiscalYearInput {
  startDate: Date; // UTC midnight, inclusive
  endDate: Date; // UTC midnight, inclusive
  granularity: PeriodGranularity;
}

export const fiscalYearService = {
  // Creates a fiscal year and auto-generates its accounting periods. The
  // exclusive company lock serializes concurrent creations so the overlap
  // check cannot race; a GiST EXCLUDE constraint backs it up at the DB level.
  async create(companyId: string, input: CreateFiscalYearInput) {
    validateFiscalYearLength(input.startDate, input.endDate);
    const periods = generatePeriods(input.startDate, input.endDate, input.granularity);

    return prisma.$transaction(async (tx) => {
      await acquireFiscalWriteLock(tx, companyId);
      const overlap = await tx.fiscalYear.findFirst({
        where: {
          companyId,
          startDate: { lte: input.endDate },
          endDate: { gte: input.startDate },
        },
      });
      if (overlap) {
        throw AppError.conflict('Fiscal year overlaps an existing fiscal year');
      }
      return tx.fiscalYear.create({
        data: {
          companyId,
          startDate: input.startDate,
          endDate: input.endDate,
          granularity: input.granularity,
          periods: {
            create: periods.map((p) => ({
              companyId,
              index: p.index,
              startDate: p.startDate,
              endDate: p.endDate,
            })),
          },
        },
        include: periodsAsc,
      });
    });
  },

  async list(companyId: string) {
    return prisma.fiscalYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
      include: periodsAsc,
    });
  },

  async getById(companyId: string, fiscalYearId: string) {
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
      include: periodsAsc,
    });
    if (!fiscalYear) throw AppError.notFound('Fiscal year not found');
    return fiscalYear;
  },

  // A fiscal year can only be closed once every one of its accounting periods
  // is already closed.
  async close(companyId: string, fiscalYearId: string) {
    return prisma.$transaction(async (tx) => {
      await acquireFiscalWriteLock(tx, companyId);
      const fiscalYear = await tx.fiscalYear.findFirst({
        where: { id: fiscalYearId, companyId },
        include: { periods: true },
      });
      if (!fiscalYear) throw AppError.notFound('Fiscal year not found');
      if (fiscalYear.status === 'CLOSED') {
        throw AppError.conflict('Fiscal year is already closed');
      }
      const openPeriods = fiscalYear.periods.filter((p) => p.status === 'OPEN').length;
      if (openPeriods > 0) {
        throw AppError.conflict(
          `All accounting periods must be closed first (${openPeriods} still open)`,
        );
      }
      return tx.fiscalYear.update({
        where: { id: fiscalYear.id },
        data: { status: 'CLOSED', closedAt: new Date() },
        include: periodsAsc,
      });
    });
  },

  // Reopening a fiscal year does NOT reopen its periods; they are reopened
  // individually afterwards.
  async reopen(companyId: string, fiscalYearId: string) {
    return prisma.$transaction(async (tx) => {
      await acquireFiscalWriteLock(tx, companyId);
      const fiscalYear = await tx.fiscalYear.findFirst({
        where: { id: fiscalYearId, companyId },
      });
      if (!fiscalYear) throw AppError.notFound('Fiscal year not found');
      if (fiscalYear.status === 'OPEN') {
        throw AppError.conflict('Fiscal year is already open');
      }
      return tx.fiscalYear.update({
        where: { id: fiscalYear.id },
        data: { status: 'OPEN', closedAt: null },
        include: periodsAsc,
      });
    });
  },

  // Fixes setup mistakes (wrong dates, wrong granularity): allowed only while
  // the fiscal year is open and nothing has been booked into its date range.
  // Periods are removed by the DB cascade.
  async remove(companyId: string, fiscalYearId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await acquireFiscalWriteLock(tx, companyId);
      const fiscalYear = await tx.fiscalYear.findFirst({
        where: { id: fiscalYearId, companyId },
      });
      if (!fiscalYear) throw AppError.notFound('Fiscal year not found');
      if (fiscalYear.status !== 'OPEN') {
        throw AppError.conflict('Only an open fiscal year can be deleted');
      }
      // JournalEntry.date is a timestamp; [startDate, endDate + 1 day) covers
      // any time of day on the inclusive end date.
      const entryCount = await tx.journalEntry.count({
        where: {
          companyId,
          date: { gte: fiscalYear.startDate, lt: addDays(fiscalYear.endDate, 1) },
        },
      });
      if (entryCount > 0) {
        throw AppError.conflict('Fiscal year has journal entries and cannot be deleted');
      }
      await tx.fiscalYear.delete({ where: { id: fiscalYear.id } });
    });
  },
};
