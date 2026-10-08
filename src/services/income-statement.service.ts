import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { addDays } from '../lib/dateOnly';
import { buildIncomeStatement, type AccountSideSum } from '../lib/incomeStatement';

// Income statement (tuloslaskelma): the period's postings summed per account
// and laid out in the statutory order (PMA 1753/2015, Annex I), optionally
// next to a comparison period.
//
// Read-only and, like the general ledger, deliberately ignorant of fiscal
// year/period state: the caller picks the date ranges, and closing a period
// must not change what the report shows.
//
// JournalEntryLine carries no companyId, so every line query scopes through
// `journalEntry: { companyId }` — see general-ledger.service.ts.

export interface DateRange {
  from: Date; // UTC midnight, inclusive
  to: Date; // UTC midnight, inclusive
}

export interface IncomeStatementFilter {
  period: DateRange;
  comparison?: DateRange | undefined;
  // Narrows both columns to the lines tagged with this cost center.
  costCenterId?: string | undefined;
}

async function sumByAccountAndSide(
  tx: Prisma.TransactionClient,
  companyId: string,
  range: DateRange,
  costCenterId: string | undefined,
): Promise<AccountSideSum[]> {
  // `type` MUST be in `by` — amounts are always positive, so summing without
  // splitting by side would yield gross turnover, not a net amount.
  const rows = await tx.journalEntryLine.groupBy({
    by: ['accountId', 'type'],
    where: {
      ...(costCenterId ? { costCenterId } : {}),
      journalEntry: {
        companyId,
        // Inclusive end date: entry dates are timestamps, not DATE columns,
        // so use < to + 1 day.
        date: { gte: range.from, lt: addDays(range.to, 1) },
      },
    },
    _sum: { amount: true },
  });
  return rows.map((row) => ({
    accountId: row.accountId,
    type: row.type,
    amount: row._sum.amount ?? 0,
  }));
}

export const incomeStatementService = {
  async get(companyId: string, filter: IncomeStatementFilter) {
    // One transaction so both columns and the account classification describe
    // the same state of the books.
    const { accounts, periodSums, comparisonSums } = await prisma.$transaction(async (tx) => {
      if (filter.costCenterId) {
        const found = await tx.costCenter.count({ where: { id: filter.costCenterId, companyId } });
        if (found === 0) throw AppError.notFound('Cost center not found');
      }

      const period = await sumByAccountAndSide(tx, companyId, filter.period, filter.costCenterId);
      const comparison = filter.comparison
        ? await sumByAccountAndSide(tx, companyId, filter.comparison, filter.costCenterId)
        : null;

      const accountIds = [
        ...new Set([...period, ...(comparison ?? [])].map((sum) => sum.accountId)),
      ];
      const found =
        accountIds.length === 0
          ? []
          : await tx.account.findMany({
              // companyId again: nothing in the DB guarantees a line's account
              // belongs to its entry's company (only write-time validation).
              where: { companyId, id: { in: accountIds } },
              include: { accountGroup: true },
            });

      return { accounts: found, periodSums: period, comparisonSums: comparison };
    });

    return buildIncomeStatement(accounts, periodSums, comparisonSums);
  },
};
