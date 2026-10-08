import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { addDays } from '../lib/dateOnly';
import { buildBalanceSheet, type BalanceSheetColumn } from '../lib/balanceSheet';
import type { AccountSideSum } from '../lib/statement';

// Balance sheet (tase): every posting up to a date summed per account and
// laid out in the statutory order (PMA 1753/2015, Annex V), optionally next
// to a comparison date.
//
// Read-only. Unlike the income statement it does look at the fiscal years —
// not their open/closed state, only their dates: the result since the start
// of the fiscal year is "Tilikauden voitto (tappio)", everything earlier
// "Edellisten tilikausien voitto (tappio)" (see src/lib/balanceSheet.ts).
//
// JournalEntryLine carries no companyId, so every line query scopes through
// `journalEntry: { companyId }` — see general-ledger.service.ts.

export interface BalanceSheetFilter {
  date: Date; // UTC midnight, inclusive
  comparisonDate?: Date | undefined;
}

// Sums of everything posted strictly before `before`.
async function sumByAccountAndSide(
  tx: Prisma.TransactionClient,
  companyId: string,
  before: Date,
): Promise<AccountSideSum[]> {
  // `type` MUST be in `by` — amounts are always positive, so summing without
  // splitting by side would yield gross turnover, not a net amount.
  const rows = await tx.journalEntryLine.groupBy({
    by: ['accountId', 'type'],
    where: { journalEntry: { companyId, date: { lt: before } } },
    _sum: { amount: true },
  });
  return rows.map((row) => ({
    accountId: row.accountId,
    type: row.type,
    amount: row._sum.amount ?? 0,
  }));
}

// The first day of the fiscal year `date` belongs to. A date after the last
// fiscal year continues from where that one ended; with no fiscal year at or
// before the date there is no earlier year to speak of (null).
async function fiscalYearStart(
  tx: Prisma.TransactionClient,
  companyId: string,
  date: Date,
): Promise<Date | null> {
  const latest = await tx.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date } },
    orderBy: { startDate: 'desc' },
  });
  if (!latest) return null;
  return date <= latest.endDate ? latest.startDate : addDays(latest.endDate, 1);
}

async function loadColumn(
  tx: Prisma.TransactionClient,
  companyId: string,
  date: Date,
): Promise<BalanceSheetColumn> {
  // Inclusive balance sheet date: entry dates are timestamps, not DATE
  // columns, so use < date + 1 day.
  const closing = await sumByAccountAndSide(tx, companyId, addDays(date, 1));
  const yearStart = await fiscalYearStart(tx, companyId, date);
  const beforeFiscalYear = yearStart ? await sumByAccountAndSide(tx, companyId, yearStart) : [];
  return { closing, beforeFiscalYear };
}

export const balanceSheetService = {
  async get(companyId: string, filter: BalanceSheetFilter) {
    // One transaction so both columns and the account classification describe
    // the same state of the books.
    const { accounts, column, comparison } = await prisma.$transaction(async (tx) => {
      const current = await loadColumn(tx, companyId, filter.date);
      const compared = filter.comparisonDate
        ? await loadColumn(tx, companyId, filter.comparisonDate)
        : null;

      // An account posted to before a fiscal year start was also posted to
      // before the date, so the closing sums name every account involved.
      const accountIds = [
        ...new Set([...current.closing, ...(compared?.closing ?? [])].map((sum) => sum.accountId)),
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

      return { accounts: found, column: current, comparison: compared };
    });

    return buildBalanceSheet(accounts, column, comparison);
  },
};
