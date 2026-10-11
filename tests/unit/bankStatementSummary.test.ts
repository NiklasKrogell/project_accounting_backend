import { describe, expect, it } from 'vitest';
import { summarizeStatement, type StatementLine } from '../../src/lib/bankStatementSummary';

const BANK = 'bank-account';
const SALES = 'sales-account';
const EXPENSE = 'expense-account';
const VAT_RECEIVABLE = 'vat-receivable-account';
const VAT_PAYABLE = 'vat-payable-account';

function line(
  accountId: string,
  type: string,
  amount: number,
  vat: { rate?: number; amount?: number; isVat?: boolean } = {},
): StatementLine {
  return {
    accountId,
    type,
    amount,
    vatRate: vat.rate ?? 0,
    vatAmount: vat.amount ?? 0,
    isVat: vat.isVat ?? false,
  };
}

// A sale of 100,00 at 25,5 % paid to the bank, as the journal entry service
// stores it: the entered lines net, the VAT as a row of its own.
const sale = [
  line(BANK, 'debit', 125.5),
  line(SALES, 'credit', 100, { rate: 25.5, amount: 25.5 }),
  line(VAT_PAYABLE, 'credit', 25.5, { isVat: true }),
];

// A purchase of 200,00 at 13,5 % paid from the bank.
const purchase = [
  line(EXPENSE, 'debit', 200, { rate: 13.5, amount: 27 }),
  line(VAT_RECEIVABLE, 'debit', 27, { isVat: true }),
  line(BANK, 'credit', 227),
];

describe('summarizeStatement', () => {
  it('has nothing to sum for a statement without entries', () => {
    expect(summarizeStatement([], BANK)).toEqual({
      bank: { deposits: 0, withdrawals: 0, net: 0 },
      vat: { receivable: 0, payable: 0, byRate: [] },
    });
  });

  it('leaves the bank totals out while no bank account is chosen', () => {
    const summary = summarizeStatement([...sale, ...purchase], null);
    expect(summary.bank).toBeNull();
    // The VAT doesn't depend on the bank account.
    expect(summary.vat.receivable).toBe(27);
    expect(summary.vat.payable).toBe(25.5);
  });

  it("sums the debits and credits on the bank account's accounting account", () => {
    const summary = summarizeStatement([...sale, ...purchase], BANK);
    expect(summary.bank).toEqual({ deposits: 125.5, withdrawals: 227, net: -101.5 });
  });

  it('groups the VAT by rate and side, purchases first and the highest rate first', () => {
    const summary = summarizeStatement(
      [
        ...sale,
        ...purchase,
        // A second purchase at the same rate joins the first one's row.
        line(EXPENSE, 'debit', 50, { rate: 13.5, amount: 6.75 }),
        line(VAT_RECEIVABLE, 'debit', 6.75, { isVat: true }),
        line(EXPENSE, 'debit', 10, { rate: 25.5, amount: 2.55 }),
        line(VAT_RECEIVABLE, 'debit', 2.55, { isVat: true }),
        line(BANK, 'credit', 69.3),
      ],
      BANK,
    );
    expect(summary.vat.byRate).toEqual([
      { vatRate: 25.5, side: 'debit', base: 10, vat: 2.55 },
      { vatRate: 13.5, side: 'debit', base: 250, vat: 33.75 },
      { vatRate: 25.5, side: 'credit', base: 100, vat: 25.5 },
    ]);
    expect(summary.vat.receivable).toBe(36.3);
    expect(summary.vat.payable).toBe(25.5);
  });

  it('counts neither the generated VAT rows nor the lines without a rate as VAT', () => {
    const summary = summarizeStatement(
      [line(EXPENSE, 'debit', 80), line(VAT_RECEIVABLE, 'debit', 20, { isVat: true }), line(BANK, 'credit', 100)],
      BANK,
    );
    expect(summary.vat).toEqual({ receivable: 0, payable: 0, byRate: [] });
  });

  it('reads the VAT off the lines of an entry booked without automatic VAT', () => {
    // No generated row: the VAT is a line the user entered, and the expense
    // line's rate and amount only describe it.
    const summary = summarizeStatement(
      [
        line(EXPENSE, 'debit', 100, { rate: 25.5, amount: 25.5 }),
        line(VAT_RECEIVABLE, 'debit', 25.5),
        line(BANK, 'credit', 125.5),
      ],
      BANK,
    );
    expect(summary.vat.byRate).toEqual([{ vatRate: 25.5, side: 'debit', base: 100, vat: 25.5 }]);
    expect(summary.vat.receivable).toBe(25.5);
  });

  it('adds in cents, so the sums carry no float error', () => {
    const summary = summarizeStatement(
      [line(BANK, 'debit', 0.1), line(BANK, 'debit', 0.2), line(SALES, 'credit', 0.3)],
      BANK,
    );
    expect(summary.bank).toEqual({ deposits: 0.3, withdrawals: 0, net: 0.3 });
  });

  it('throws on an unrecognised line type rather than guessing a side', () => {
    expect(() => summarizeStatement([line(BANK, 'DEBIT', 1)], BANK)).toThrow(
      /Unknown journal entry line type/,
    );
  });
});
