// Value added tax (arvonlisävero) on journal entry lines. Deliberately DB-free,
// like lib/ledger.ts: the service resolves which accounts the VAT rows post to,
// this does the arithmetic and decides the rows.
//
// Line amounts are NET: a line's VAT is amount x rate, added on top, and
// posted as a row of its own on a VAT account so that the ledger and the
// statements see it. The entry must balance with those rows counted.
//
// The UI mirrors vatCents (src/lib/vat.ts there) so the dialog previews exactly
// what is posted here — change both together.

import type { EntrySide } from './ledger';
import { fromCents, toCents } from './money';

// The two accounts ChartOfAccounts names for VAT rows.
export type VatAccountKind = 'receivable' | 'payable';

export interface VatSourceLine {
  amount: number;
  vatRate: number;
  type: EntrySide;
  description: string;
}

// A VAT row to post, before its account is resolved.
export interface GeneratedVatLine {
  vatAccount: VatAccountKind;
  amount: number;
  type: EntrySide;
  vatRate: number;
  description: string;
}

// VAT in cents on a net amount in cents. The rate is a percentage taken to two
// decimals (25.5 -> 2550), which keeps the product an integer: multiplying by
// 0.255 instead would put a half cent just under .5 and round it down.
export function vatCents(amountCents: number, vatRate: number): number {
  return Math.round((amountCents * Math.round(vatRate * 100)) / 10000);
}

// The VAT of one line in euros, as stored in JournalEntryLine.vatAmount.
export function lineVatAmount(line: { amount: number; vatRate: number }): number {
  return fromCents(vatCents(toCents(line.amount), line.vatRate));
}

// One VAT row per line that carries VAT, on the same side as the line: VAT on
// a debit is deductible (receivable), VAT on a credit is owed (payable). A
// credit note therefore lands on the other VAT account rather than reducing
// its own; the net VAT position is the same either way.
export function buildVatLines(lines: readonly VatSourceLine[]): GeneratedVatLine[] {
  const vatLines: GeneratedVatLine[] = [];
  for (const line of lines) {
    const cents = vatCents(toCents(line.amount), line.vatRate);
    if (cents === 0) continue;
    vatLines.push({
      vatAccount: line.type === 'debit' ? 'receivable' : 'payable',
      amount: fromCents(cents),
      type: line.type,
      // The rate the row was computed at, so VAT can later be reported per rate
      // from the VAT account's own rows.
      vatRate: line.vatRate,
      description: line.description,
    });
  }
  return vatLines;
}
