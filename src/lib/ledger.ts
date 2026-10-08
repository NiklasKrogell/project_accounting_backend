// General ledger (pääkirja) arithmetic. Deliberately DB-free so the money math
// is unit-testable without a database — the service does Prisma and tenant
// scoping, this does 100% of the summing.
//
// Sign convention: DEBIT-POSITIVE (balance = debits - credits). Credit-nature
// accounts (revenue, liabilities, equity) therefore carry negative balances.
// Presenting those as positive is a tuloslaskelma/tase concern, not a ledger
// one, so nothing here is mainClass-aware.
//
// JournalEntryLine.amount is always POSITIVE; direction lives only in `type`.

import { fromCents, toCents } from './money';

export type EntrySide = 'debit' | 'credit';

// Euro sums of the lines posted before the reporting period, split by side.
export interface LedgerOpening {
  debit: number;
  credit: number;
}

export interface LedgerTotals {
  openingBalance: number;
  debitTotal: number;
  creditTotal: number;
  closingBalance: number;
}

export type WithRunningBalance<L> = L & { runningBalance: number };

export interface AccountLedger<L> extends LedgerTotals {
  lines: Array<WithRunningBalance<L>>;
}

export const EMPTY_OPENING: LedgerOpening = { debit: 0, credit: 0 };

// `type` is a plain String column guarded only by the create/update Zod enum,
// so an unexpected value (a legacy 'DEBIT', an empty string) must not be
// silently signed as a credit — a mis-signed ledger is worse than a 500.
export function signedCents(line: { amount: number; type: string }): number {
  const cents = toCents(line.amount);
  if (line.type === 'debit') return cents;
  if (line.type === 'credit') return -cents;
  throw new Error(`Unknown journal entry line type: ${JSON.stringify(line.type)}`);
}

// Accumulates a running balance from `opening` across `lines`, in the order
// given. Does NOT sort — presentation order is the query's job, and reordering
// here would silently disagree with the order the caller serialises.
export function buildAccountLedger<L extends { amount: number; type: string }>(
  opening: LedgerOpening,
  lines: readonly L[],
): AccountLedger<L> {
  const openingCents = toCents(opening.debit) - toCents(opening.credit);

  let debitCents = 0;
  let creditCents = 0;
  let runningCents = openingCents;

  const withBalances = lines.map((line) => {
    const signed = signedCents(line);
    if (signed >= 0) debitCents += signed;
    else creditCents += -signed;
    runningCents += signed;
    return { ...line, runningBalance: fromCents(runningCents) };
  });

  return {
    openingBalance: fromCents(openingCents),
    debitTotal: fromCents(debitCents),
    creditTotal: fromCents(creditCents),
    closingBalance: fromCents(runningCents),
    lines: withBalances,
  };
}

// Buckets lines by account, preserving the input order within each bucket.
export function groupByAccountId<L extends { accountId: string }>(
  lines: readonly L[],
): Map<string, L[]> {
  const byAccount = new Map<string, L[]>();
  for (const line of lines) {
    const bucket = byAccount.get(line.accountId);
    if (bucket) bucket.push(line);
    else byAccount.set(line.accountId, [line]);
  }
  return byAccount;
}
