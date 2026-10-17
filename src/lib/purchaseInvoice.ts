// Purchase invoice (ostolasku) arithmetic. Deliberately DB-free, like
// lib/vat.ts: the service reads and writes the invoice, this sums its rows and
// decides the journal entry approving it books.
//
// An invoice's rows are one-sided: each is a cost (or asset) to debit, stored
// net with its VAT like a journal entry line. The other side, the debt to the
// supplier, is implied and appears only in the entry: one credit line on the
// trade payables account for the invoice's gross total.

import type { EntrySide } from './ledger';
import { fromCents, toCents } from './money';
import type { VatBasis } from './vat';

export interface PurchaseInvoiceRow {
  accountId: string;
  // Net of VAT, as stored.
  amount: number;
  vatRate: number;
  vatAmount: number;
  description: string;
  costCenterId: string | null;
}

export interface InvoiceTotals {
  net: number;
  vat: number;
  gross: number;
}

// Summed in cents (see lib/money.ts).
export function invoiceTotals(
  rows: readonly Pick<PurchaseInvoiceRow, 'amount' | 'vatAmount'>[],
): InvoiceTotals {
  const net = rows.reduce((s, r) => s + toCents(r.amount), 0);
  const vat = rows.reduce((s, r) => s + toCents(r.vatAmount), 0);
  return { net: fromCents(net), vat: fromCents(vat), gross: fromCents(net + vat) };
}

// The amount of a row as it was entered: its net amount, or on a gross basis
// its net amount and VAT together. splitVat (lib/vat.ts) gives back exactly
// the stored net and VAT from it on the same basis: that is why an invoice
// keeps its basis.
export function enteredAmount(
  row: Pick<PurchaseInvoiceRow, 'amount' | 'vatAmount'>,
  basis: VatBasis,
): number {
  return basis === 'gross' ? fromCents(toCents(row.amount) + toCents(row.vatAmount)) : row.amount;
}

export interface PurchaseEntryLine {
  accountId: string;
  amount: number;
  description: string;
  vatRate: number;
  type: EntrySide;
  costCenterId: string | null;
}

// The journal entry an approved invoice is booked with, in the shape the
// journal entry service takes.
export interface PurchaseEntry {
  voucherType: 'PURCHASE';
  date: Date;
  description: string;
  accountId: string;
  vatBasis: VatBasis;
  automaticVat: true;
  lines: PurchaseEntryLine[];
}

export interface PurchaseEntrySource {
  invoiceNumber: string;
  entryDate: Date;
  description: string;
  vatBasis: VatBasis;
  lines: readonly PurchaseInvoiceRow[];
}

// The longest description a journal entry takes through its API.
const MAX_DESCRIPTION = 500;

// One debit line per row, entered on the invoice's own basis so that the VAT
// rows the journal entry service generates from them are the rows' stored VAT
// to the cent, and one credit line for the gross total on the trade payables
// account, carrying no VAT. The entry is the payables account's, like a bank
// statement's entries are the bank account's.
export function buildPurchaseEntry(
  invoice: PurchaseEntrySource,
  supplierName: string,
  payablesAccountId: string,
): PurchaseEntry {
  const title = `${supplierName} ${invoice.invoiceNumber}`;
  const description = (invoice.description ? `${title}: ${invoice.description}` : title).slice(
    0,
    MAX_DESCRIPTION,
  );
  return {
    voucherType: 'PURCHASE',
    date: invoice.entryDate,
    description,
    accountId: payablesAccountId,
    vatBasis: invoice.vatBasis,
    automaticVat: true,
    lines: [
      ...invoice.lines.map((row) => ({
        accountId: row.accountId,
        amount: enteredAmount(row, invoice.vatBasis),
        description: row.description,
        vatRate: row.vatRate,
        type: 'debit' as const,
        costCenterId: row.costCenterId,
      })),
      {
        accountId: payablesAccountId,
        amount: invoiceTotals(invoice.lines).gross,
        description,
        vatRate: 0,
        type: 'credit' as const,
        costCenterId: null,
      },
    ],
  };
}
