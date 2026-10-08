// What the income statement and the balance sheet builders share: the shape of
// their input sums and of an amount pair, and the netting of an account's two
// sides. DB-free.

import { toCents } from './money';

// One groupBy(accountId, type) row: the sum of an account's lines on one side.
export interface AccountSideSum {
  accountId: string;
  type: string;
  amount: number;
}

// comparisonAmount is null throughout when no comparison column was requested.
export interface StatementAmounts {
  amount: number;
  comparisonAmount: number | null;
}

export interface StatementAccountRow extends StatementAmounts {
  accountId: string;
  accountNumber: string;
  accountName: string;
}

// Net credit-positive cents per account. `type` is a plain String column, so
// an unexpected value must not be silently signed — see ledger.ts signedCents.
export function netCentsByAccount(sums: readonly AccountSideSum[]): Map<string, number> {
  const byAccount = new Map<string, number>();
  for (const sum of sums) {
    const cents = toCents(sum.amount);
    let signed: number;
    if (sum.type === 'credit') signed = cents;
    else if (sum.type === 'debit') signed = -cents;
    else throw new Error(`Unknown journal entry line type: ${JSON.stringify(sum.type)}`);
    byAccount.set(sum.accountId, (byAccount.get(sum.accountId) ?? 0) + signed);
  }
  return byAccount;
}
