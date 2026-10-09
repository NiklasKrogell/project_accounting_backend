// Value added tax (arvonlisävero) on journal entry lines. Deliberately DB-free,
// like lib/ledger.ts: the service resolves which accounts the VAT rows post to,
// this does the arithmetic and decides the rows.
//
// A line is always STORED net, and its VAT is posted as a row of its own on a
// VAT account so that the ledger and the statements see it. The entry must
// balance with those rows counted. What varies is how the amounts are ENTERED
// (VatBasis): net, with the VAT added on top, or gross, with the VAT taken out
// of the amount.
//
// The UI mirrors the two vatCents functions (src/lib/vat.ts there) so the
// dialog previews exactly what is posted here — change both together.

import type { EntrySide } from './ledger';
import { fromCents, toCents } from './money';

// How the entered amounts of an entry relate to VAT. 'net': 100,00 at 25,5 %
// is stored as 100,00 with a VAT row of 25,50. 'gross': 125,50 at 25,5 % is
// stored as the same two rows. The basis is not stored with the entry: the
// gross amount of a line is always its amount + vatAmount.
export type VatBasis = 'net' | 'gross';

// The Finnish VAT rates an account can be given as its default (see
// Account.defaultVatRate). The UI offers the same ones on an entry line
// (src/lib/vat.ts there) — change both together.
export const VAT_RATES = [25.5, 13.5, 10, 0] as const;

// The two accounts ChartOfAccounts names for VAT rows.
export type VatAccountKind = 'receivable' | 'payable';

export interface VatSourceLine {
  amount: number;
  vatRate: number;
  type: EntrySide;
  description: string;
  costCenterId?: string | null;
}

// A VAT row to post, before its account is resolved. It is the tax itself, so
// it has no VAT rate or VAT amount of its own; the description and the cost
// center are those of the line it was computed from.
export interface GeneratedVatLine {
  vatAccount: VatAccountKind;
  amount: number;
  type: EntrySide;
  description: string;
  costCenterId: string | null;
}

// VAT in cents on a net amount in cents. The rate is a percentage taken to two
// decimals (25.5 -> 2550), which keeps the product an integer: multiplying by
// 0.255 instead would put a half cent just under .5 and round it down.
export function vatCents(netCents: number, vatRate: number): number {
  return Math.round((netCents * Math.round(vatRate * 100)) / 10000);
}

// VAT in cents contained in a gross amount in cents. Not the same as taking
// the net out first and applying vatCents to it: that can land a cent away,
// and the net and the VAT would no longer add up to the amount entered.
export function vatCentsInGross(grossCents: number, vatRate: number): number {
  const rate = Math.round(vatRate * 100);
  return Math.round((grossCents * rate) / (10000 + rate));
}

// Splits an entered amount into the net amount stored on the line and its
// VAT, in euros. On a gross basis the two always add up to the entered amount.
export function splitVat(
  line: { amount: number; vatRate: number },
  basis: VatBasis,
): { net: number; vat: number } {
  const cents = toCents(line.amount);
  if (basis === 'gross') {
    const vat = vatCentsInGross(cents, line.vatRate);
    return { net: fromCents(cents - vat), vat: fromCents(vat) };
  }
  return { net: line.amount, vat: fromCents(vatCents(cents, line.vatRate)) };
}

// One VAT row per line that carries VAT, on the same side as the line: VAT on
// a debit is deductible (receivable), VAT on a credit is owed (payable). A
// credit note therefore lands on the other VAT account rather than reducing
// its own; the net VAT position is the same either way.
export function buildVatLines(lines: readonly VatSourceLine[], basis: VatBasis): GeneratedVatLine[] {
  const vatLines: GeneratedVatLine[] = [];
  for (const line of lines) {
    const { vat } = splitVat(line, basis);
    if (vat === 0) continue;
    vatLines.push({
      vatAccount: line.type === 'debit' ? 'receivable' : 'payable',
      amount: vat,
      type: line.type,
      description: line.description,
      costCenterId: line.costCenterId ?? null,
    });
  }
  return vatLines;
}
