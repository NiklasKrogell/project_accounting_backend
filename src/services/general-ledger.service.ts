import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { addDays } from '../lib/dateOnly';
import { EMPTY_OPENING, buildAccountLedger, groupByAccountId, type LedgerOpening } from '../lib/ledger';

// General ledger (pääkirja): the journal regrouped by account. Each account
// carries its opening balance, its lines in date order with a running balance,
// period debit/credit totals and a closing balance.
//
// Read-only and deliberately ignorant of fiscal year/period state — closing a
// period must not change what the ledger reports.
//
// Pagination is over ACCOUNTS, not lines, so an account's postings are never
// split across pages. meta.total is therefore a count of accounts.
//
// Note: JournalEntryLine carries no companyId, so every line query scopes
// through `journalEntry: { companyId }`. Nothing in the DB enforces that an
// entry and its lines' accounts belong to the same company — only
// assertAccountsInCompany does, at write time.
//
// A possible future optimisation, deliberately not taken: denormalising
// companyId/date onto JournalEntryLine would allow a single composite index
// and collapse this to one query, at the cost of keeping them in sync on
// every entry date change.

export interface GeneralLedgerFilter {
  from?: Date | undefined; // UTC midnight, inclusive
  to?: Date | undefined; // UTC midnight, inclusive
  accountId?: string | undefined;
  take: number;
  skip: number;
}

const withGroup = { accountGroup: true as const };

// The entry fields the report shows alongside each line.
const entryColumns = {
  id: true,
  date: true,
  voucherType: true,
  voucherNumber: true,
  description: true,
} as const;

export const generalLedgerService = {
  async list(companyId: string, filter: GeneralLedgerFilter) {
    // Two DISTINCT date predicates. The period filter is a closed range; the
    // opening filter is strictly before `from`. Sharing one helper between
    // them would count every line dated exactly `from` twice.
    const periodDate =
      filter.from || filter.to
        ? {
            ...(filter.from ? { gte: filter.from } : {}),
            // Inclusive end date: entry dates are timestamps, not DATE
            // columns, so use < to + 1 day (lte would drop a row stored with
            // a time component).
            ...(filter.to ? { lt: addDays(filter.to, 1) } : {}),
          }
        : undefined;

    const entryFilter: Prisma.JournalEntryWhereInput = {
      companyId,
      ...(periodDate ? { date: periodDate } : {}),
    };

    // Built once and shared by findMany and count, so a page can never
    // describe a different population than meta.total does.
    const accountWhere: Prisma.AccountWhereInput = filter.accountId
      ? // An explicitly requested account is always returned, even with no
        // movement, so "no postings" is distinguishable from "wrong company".
        { companyId, id: filter.accountId }
      : { companyId, lines: { some: { journalEntry: entryFilter } } };

    // One transaction: the account page's ids are needed before the line and
    // opening queries can run, and three independent statements would let a
    // concurrent entry edit produce a ledger whose opening balance disagrees
    // with its lines.
    const { accounts, lines, openings, total } = await prisma.$transaction(async (tx) => {
      if (filter.accountId) {
        const found = await tx.account.count({ where: { id: filter.accountId, companyId } });
        if (found === 0) throw AppError.notFound('Account not found');
      }

      const [pageAccounts, accountTotal] = await Promise.all([
        tx.account.findMany({
          where: accountWhere,
          // number is unique per company, so this is already a total order and
          // needs no tie-break. It is a String, so ordering is lexicographic
          // ('900' after '1000') — consistent with accountService.list.
          orderBy: { number: 'asc' },
          take: filter.take,
          skip: filter.skip,
          include: withGroup,
        }),
        tx.account.count({ where: accountWhere }),
      ]);

      const accountIds = pageAccounts.map((a) => a.id);
      if (accountIds.length === 0) {
        return { accounts: pageAccounts, lines: [], openings: [], total: accountTotal };
      }

      const pageLines = await tx.journalEntryLine.findMany({
        where: { accountId: { in: accountIds }, journalEntry: entryFilter },
        include: { journalEntry: { select: entryColumns } },
        // Lines WITHIN one entry share a date and createdAt, so the only
        // tie-break left is the uuid: their relative order is stable across
        // requests but arbitrary. JournalEntryLine has no ordinal column to
        // order by — adding one is the fix if voucher-order display matters.
        orderBy: [
          { journalEntry: { date: 'asc' } },
          { journalEntry: { createdAt: 'asc' } },
          { id: 'asc' },
        ],
      });

      // Opening balances: the net of everything posted strictly before `from`.
      // Without a `from` there is no "before", so every opening is zero.
      // `type` MUST be in `by` — amounts are always positive, so summing
      // without splitting by side would yield gross turnover, not a balance.
      const openingRows = filter.from
        ? await tx.journalEntryLine.groupBy({
            by: ['accountId', 'type'],
            where: {
              accountId: { in: accountIds },
              journalEntry: { companyId, date: { lt: filter.from } },
            },
            _sum: { amount: true },
          })
        : [];

      return { accounts: pageAccounts, lines: pageLines, openings: openingRows, total: accountTotal };
    });

    // Seed every account on the page first: groupBy returns no row at all for
    // an account with no prior history.
    const openingByAccount = new Map<string, LedgerOpening>(
      accounts.map((a) => [a.id, { ...EMPTY_OPENING }]),
    );
    for (const row of openings) {
      const opening = openingByAccount.get(row.accountId);
      if (!opening) continue;
      const sum = row._sum.amount ?? 0;
      if (row.type === 'debit') opening.debit = sum;
      else if (row.type === 'credit') opening.credit = sum;
      // Any other `type` value is left out rather than guessed at; the line
      // query below would throw on it via signedCents.
    }

    const linesByAccount = groupByAccountId(lines);

    const ledgers = accounts.map((account) => ({
      account,
      ...buildAccountLedger(
        openingByAccount.get(account.id) ?? EMPTY_OPENING,
        linesByAccount.get(account.id) ?? [],
      ),
    }));

    return { ledgers, total };
  },
};
