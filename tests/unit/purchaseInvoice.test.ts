import { describe, expect, it } from 'vitest';
import {
  buildPurchaseEntry,
  enteredAmount,
  invoiceTotals,
  type PurchaseInvoiceRow,
} from '../../src/lib/purchaseInvoice';
import { buildVatLines, splitVat, type VatBasis } from '../../src/lib/vat';
import { toCents } from '../../src/lib/money';
import { parseDateOnly } from '../../src/lib/dateOnly';

// Rows as the service stores them: entered on a basis, split into net + VAT.
function storedRows(
  entered: { amount: number; vatRate: number; costCenterId?: string }[],
  basis: VatBasis,
): PurchaseInvoiceRow[] {
  return entered.map((row, i) => {
    const { net, vat } = splitVat(row, basis);
    return {
      accountId: `account-${i}`,
      amount: net,
      vatRate: row.vatRate,
      vatAmount: vat,
      description: `row ${i}`,
      costCenterId: row.costCenterId ?? null,
    };
  });
}

const source = (lines: PurchaseInvoiceRow[], vatBasis: VatBasis, description = '') => ({
  invoiceNumber: 'INV-1',
  entryDate: parseDateOnly('2026-03-15'),
  description,
  vatBasis,
  lines,
});

// What the journal entry service would store and balance from the entry.
function bookedSides(entry: ReturnType<typeof buildPurchaseEntry>) {
  const net = entry.lines.map((l) => ({ type: l.type, cents: toCents(splitVat(l, entry.vatBasis).net) }));
  const vat = buildVatLines(entry.lines, entry.vatBasis).map((l) => ({
    type: l.type,
    cents: toCents(l.amount),
  }));
  const sum = (side: 'debit' | 'credit') =>
    [...net, ...vat].filter((l) => l.type === side).reduce((s, l) => s + l.cents, 0);
  return { debit: sum('debit'), credit: sum('credit'), vatCents: vat.map((l) => l.cents) };
}

describe('invoiceTotals', () => {
  it('sums net, VAT and gross in cents', () => {
    const totals = invoiceTotals([
      { amount: 0.1, vatAmount: 0.03 },
      { amount: 0.2, vatAmount: 0.05 },
    ]);
    expect(totals).toEqual({ net: 0.3, vat: 0.08, gross: 0.38 });
  });

  it('is zero for no rows', () => {
    expect(invoiceTotals([])).toEqual({ net: 0, vat: 0, gross: 0 });
  });
});

describe('enteredAmount', () => {
  it('is the net amount on a net basis and net + VAT on a gross basis', () => {
    const row = { amount: 100, vatAmount: 25.5 };
    expect(enteredAmount(row, 'net')).toBe(100);
    expect(enteredAmount(row, 'gross')).toBe(125.5);
  });
});

describe('buildPurchaseEntry', () => {
  it('debits the rows and credits the gross total to trade payables', () => {
    const lines = storedRows([{ amount: 100, vatRate: 25.5, costCenterId: 'cc' }, { amount: 40, vatRate: 0 }], 'net');
    const entry = buildPurchaseEntry(source(lines, 'net'), 'Toimittaja Oy', 'payables');

    expect(entry).toMatchObject({
      voucherType: 'PURCHASE',
      date: parseDateOnly('2026-03-15'),
      description: 'Toimittaja Oy INV-1',
      accountId: 'payables',
      vatBasis: 'net',
      automaticVat: true,
    });
    expect(entry.lines).toEqual([
      { accountId: 'account-0', amount: 100, description: 'row 0', vatRate: 25.5, type: 'debit', costCenterId: 'cc' },
      { accountId: 'account-1', amount: 40, description: 'row 1', vatRate: 0, type: 'debit', costCenterId: null },
      {
        accountId: 'payables',
        amount: 165.5,
        description: 'Toimittaja Oy INV-1',
        vatRate: 0,
        type: 'credit',
        costCenterId: null,
      },
    ]);
  });

  it('adds the invoice description to the entry description, within 500 characters', () => {
    const lines = storedRows([{ amount: 10, vatRate: 0 }], 'net');
    expect(buildPurchaseEntry(source(lines, 'net', 'Toimistotarvikkeet'), 'S', 'p').description).toBe(
      'S INV-1: Toimistotarvikkeet',
    );
    expect(buildPurchaseEntry(source(lines, 'net', 'x'.repeat(600)), 'S', 'p').description).toHaveLength(500);
  });

  it.each<VatBasis>(['net', 'gross'])(
    'books exactly the stored VAT and balances on a %s basis',
    (basis) => {
      // Amounts where taking VAT out of a gross amount and adding it to a net
      // one can land a cent apart, and half cents.
      const lines = storedRows(
        [
          { amount: 10, vatRate: 25.5 },
          { amount: 19.99, vatRate: 25.5 },
          { amount: 3, vatRate: 13.5 },
          { amount: 0.1, vatRate: 25.5 },
          { amount: 333.33, vatRate: 10 },
          { amount: 50, vatRate: 0 },
        ],
        basis,
      );
      const entry = buildPurchaseEntry(source(lines, basis), 'S', 'p');
      const booked = bookedSides(entry);

      expect(booked.vatCents).toEqual(lines.filter((l) => l.vatAmount !== 0).map((l) => toCents(l.vatAmount)));
      expect(booked.debit).toBe(booked.credit);
      expect(booked.credit).toBe(toCents(invoiceTotals(lines).gross));
    },
  );
});
