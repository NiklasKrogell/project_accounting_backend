// The totals of a bank statement (tiliote), summed from the lines of the
// journal entries booked from it. Deliberately DB-free, like lib/ledger.ts and
// lib/vat.ts: the service fetches the lines, this does the arithmetic.
//
// Nothing is read from the statement's PDF, so everything here describes what
// has been booked, not what the statement itself says.

import type { EntrySide } from './ledger';
import { fromCents, toCents } from './money';

export interface StatementLine {
  accountId: string;
  amount: number;
  type: string;
  vatRate: number;
  vatAmount: number;
  isVat: boolean;
}

// What the entries moved on the bank account's accounting account: a debit is
// money in, a credit money out.
export interface BankTotals {
  deposits: number;
  withdrawals: number;
  net: number;
}

// The lines of one VAT rate on one side: debit lines are purchases (their VAT
// is receivable), credit lines sales (payable), as in buildVatLines.
export interface VatRateTotals {
  vatRate: number;
  side: EntrySide;
  base: number;
  vat: number;
}

export interface StatementSummary {
  // Null when the statement has no bank account chosen yet.
  bank: BankTotals | null;
  vat: {
    receivable: number;
    payable: number;
    byRate: VatRateTotals[];
  };
}

// `type` is a plain String column (see signedCents in lib/ledger.ts): a value
// that is neither side must not be quietly counted as one of them.
function sideOf(line: { type: string }): EntrySide {
  if (line.type === 'debit' || line.type === 'credit') return line.type;
  throw new Error(`Unknown journal entry line type: ${JSON.stringify(line.type)}`);
}

// The VAT figures come from the entered lines (their vatRate and vatAmount),
// not from the generated VAT rows: a row doesn't know its rate, and an entry
// booked without automatic VAT has none, while its lines still say what they
// carry. The totals are the sums of the by-rate rows, so the two always agree.
export function summarizeStatement(
  lines: readonly StatementLine[],
  bankLedgerAccountId: string | null,
): StatementSummary {
  let depositCents = 0;
  let withdrawalCents = 0;
  // Keyed by side and by the rate in hundredths of a percent, which keeps
  // 25.5 from being told apart from itself by a float.
  const byRate = new Map<string, { vatRate: number; side: EntrySide; base: number; vat: number }>();

  for (const line of lines) {
    const side = sideOf(line);
    const cents = toCents(line.amount);

    if (line.accountId === bankLedgerAccountId) {
      if (side === 'debit') depositCents += cents;
      else withdrawalCents += cents;
    }

    if (line.isVat || line.vatRate === 0) continue;
    const key = `${side}:${Math.round(line.vatRate * 100)}`;
    const bucket = byRate.get(key) ?? { vatRate: line.vatRate, side, base: 0, vat: 0 };
    bucket.base += cents;
    bucket.vat += toCents(line.vatAmount);
    byRate.set(key, bucket);
  }

  // Purchases before sales, the highest rate first.
  const rows = [...byRate.values()].sort(
    (a, b) => Number(a.side === 'credit') - Number(b.side === 'credit') || b.vatRate - a.vatRate,
  );
  const vatOf = (side: EntrySide) =>
    rows.filter((row) => row.side === side).reduce((sum, row) => sum + row.vat, 0);

  return {
    bank:
      bankLedgerAccountId === null
        ? null
        : {
            deposits: fromCents(depositCents),
            withdrawals: fromCents(withdrawalCents),
            net: fromCents(depositCents - withdrawalCents),
          },
    vat: {
      receivable: fromCents(vatOf('debit')),
      payable: fromCents(vatOf('credit')),
      byRate: rows.map((row) => ({
        vatRate: row.vatRate,
        side: row.side,
        base: fromCents(row.base),
        vat: fromCents(row.vat),
      })),
    },
  };
}
