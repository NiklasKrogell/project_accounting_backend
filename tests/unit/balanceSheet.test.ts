import { describe, expect, it } from 'vitest';
import type { AccountMainClass, BalanceSheetItem } from '../../src/generated/prisma/client';
import {
  buildBalanceSheet,
  type BalanceSheet,
  type BalanceSheetAccountInput,
  type BalanceSheetNode,
} from '../../src/lib/balanceSheet';
import type { AccountSideSum } from '../../src/lib/statement';

const account = (
  number: string,
  mainClass: AccountMainClass | null,
  item: BalanceSheetItem | null = null,
): BalanceSheetAccountInput => ({
  id: `acc-${number}`,
  number,
  name: `Tili ${number}`,
  accountGroup: mainClass ? { mainClass, balanceSheetItem: item } : null,
});

const debit = (number: string, amount: number): AccountSideSum => ({
  accountId: `acc-${number}`,
  type: 'debit',
  amount,
});
const credit = (number: string, amount: number): AccountSideSum => ({
  accountId: `acc-${number}`,
  type: 'credit',
  amount,
});

const side = (sheet: BalanceSheet, key: string) => {
  const found = sheet.sides.find((s) => s.side === key);
  if (!found) throw new Error(`no side ${key}`);
  return found;
};

const section = (sheet: BalanceSheet, mainClass: AccountMainClass) => {
  const found = sheet.sides.flatMap((s) => s.classes).find((c) => c.mainClass === mainClass);
  if (!found) throw new Error(`no section ${mainClass}`);
  return found;
};

function node(sheet: BalanceSheet, key: string): BalanceSheetNode {
  const walk = (list: BalanceSheetNode[]): BalanceSheetNode | undefined => {
    for (const candidate of list) {
      if (candidate.key === key) return candidate;
      const nested = walk(candidate.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const found = walk(sheet.sides.flatMap((s) => s.classes).flatMap((c) => c.items));
  if (!found) throw new Error(`no item ${key}`);
  return found;
}

const accounts = [
  account('1150', 'FIXED_ASSETS', 'MACHINERY_AND_EQUIPMENT'),
  account('1700', 'CURRENT_ASSETS', 'SHORT_TERM_TRADE_RECEIVABLES'),
  account('1710', 'CURRENT_ASSETS', 'LONG_TERM_LOAN_RECEIVABLES'),
  account('1910', 'CURRENT_ASSETS', 'CASH_AND_BANK'),
  account('2000', 'EQUITY', 'SHARE_CAPITAL'),
  account('2040', 'EQUITY', 'INVESTED_UNRESTRICTED_EQUITY_RESERVE'),
  account('2050', 'EQUITY', 'RETAINED_EARNINGS'),
  account('2200', 'ACCUMULATED_APPROPRIATIONS', 'DEPRECIATION_DIFFERENCE'),
  account('2600', 'LIABILITIES', 'LONG_TERM_LOANS_FROM_FINANCIAL_INSTITUTIONS'),
  account('2700', 'LIABILITIES', 'SHORT_TERM_TRADE_PAYABLES'),
  account('3000', 'REVENUE'),
  account('5000', 'PERSONNEL_EXPENSES'),
  account('9000', 'APPROPRIATIONS'),
];

// Everything up to the balance sheet date. Debits and credits are equal
// (23 300 each), as they are in real books.
const closing = [
  debit('1150', 4000),
  debit('1700', 1500),
  debit('1710', 800),
  debit('1910', 9000),
  credit('1910', 2600), // payments out: the bank nets to 6400
  credit('2000', 2500),
  credit('2040', 1000),
  debit('2050', 300), // a dividend paid out of earlier profits
  credit('2200', 100),
  credit('2600', 3000),
  credit('2700', 900),
  credit('3000', 13200),
  debit('5000', 7600),
  debit('9000', 100),
];

// The part of the income statement accounts posted in earlier fiscal years:
// an earlier result of 5000 - 3000 = 2000.
const beforeFiscalYear = [credit('3000', 5000), debit('5000', 3000), debit('1910', 2000)];

describe('buildBalanceSheet', () => {
  const sheet = buildBalanceSheet(accounts, { closing, beforeFiscalYear }, null);

  it('presents assets debit-positive and equity and liabilities credit-positive', () => {
    expect(node(sheet, 'MACHINERY_AND_EQUIPMENT').amount).toBe(4000);
    expect(node(sheet, 'CASH_AND_BANK').amount).toBe(6400);
    expect(node(sheet, 'SHARE_CAPITAL').amount).toBe(2500);
    expect(node(sheet, 'SHORT_TERM_TRADE_PAYABLES').amount).toBe(900);
  });

  it('sums items into their headings, sections and sides', () => {
    expect(node(sheet, 'TANGIBLE_ASSETS').amount).toBe(4000);
    expect(section(sheet, 'FIXED_ASSETS').amount).toBe(4000);
    expect(node(sheet, 'RESERVES').amount).toBe(1000);
    expect(section(sheet, 'CURRENT_ASSETS').amount).toBe(8700);
    expect(side(sheet, 'ASSETS').amount).toBe(12700);
  });

  it('shows long-term and short-term receivables and liabilities separately', () => {
    expect(node(sheet, 'LONG_TERM_RECEIVABLES').amount).toBe(800);
    expect(node(sheet, 'SHORT_TERM_RECEIVABLES').amount).toBe(1500);
    expect(node(sheet, 'RECEIVABLES').amount).toBe(2300);
    expect(node(sheet, 'LONG_TERM_LIABILITIES').amount).toBe(3000);
    expect(node(sheet, 'SHORT_TERM_LIABILITIES').amount).toBe(900);
    expect(section(sheet, 'LIABILITIES').amount).toBe(3900);
  });

  it('derives the profit for the year from the income statement accounts', () => {
    // (13200 - 7600 - 100) in all, less the 2000 of earlier years.
    const profit = node(sheet, 'PROFIT_FOR_THE_FINANCIAL_YEAR');
    expect(profit.amount).toBe(3500);
    expect(profit.derived).toEqual({ amount: 3500, comparisonAmount: null });
    expect(profit.accounts).toEqual([]);
  });

  it('adds earlier results to the postings made to retained earnings', () => {
    const retained = node(sheet, 'RETAINED_EARNINGS');
    expect(retained.derived?.amount).toBe(2000);
    expect(retained.accounts.map((a) => [a.accountNumber, a.amount])).toEqual([['2050', -300]]);
    expect(retained.amount).toBe(1700);
  });

  it('marks no other item as derived', () => {
    expect(node(sheet, 'SHARE_CAPITAL').derived).toBeNull();
    expect(node(sheet, 'RESERVES').derived).toBeNull();
  });

  it('balances: vastaavaa equals vastattavaa', () => {
    expect(section(sheet, 'EQUITY').amount).toBe(8700);
    expect(section(sheet, 'ACCUMULATED_APPROPRIATIONS').amount).toBe(100);
    expect(side(sheet, 'EQUITY_AND_LIABILITIES').amount).toBe(12700);
    expect(sheet.difference).toEqual({ amount: 0, comparisonAmount: null });
    expect(sheet.unclassified).toEqual([]);
  });

  it('keeps income statement accounts out of the account rows', () => {
    expect(JSON.stringify(sheet)).not.toContain('acc-3000');
  });

  it('puts the whole result on the current year when there is no earlier fiscal year', () => {
    const first = buildBalanceSheet(accounts, { closing, beforeFiscalYear: [] }, null);
    expect(node(first, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(5500);
    expect(node(first, 'RETAINED_EARNINGS').amount).toBe(-300);
    expect(first.difference.amount).toBe(0);
  });

  it('fills the comparison column from its own sums', () => {
    const earlier = [debit('1910', 2000), credit('3000', 5000), debit('5000', 3000)];
    const compared = buildBalanceSheet(
      accounts,
      { closing, beforeFiscalYear },
      { closing: earlier, beforeFiscalYear: [] },
    );
    expect(node(compared, 'CASH_AND_BANK').comparisonAmount).toBe(2000);
    expect(node(compared, 'PROFIT_FOR_THE_FINANCIAL_YEAR').comparisonAmount).toBe(2000);
    expect(node(compared, 'RETAINED_EARNINGS').comparisonAmount).toBe(0);
    // No machinery yet at the comparison date: zero, not null.
    expect(node(compared, 'MACHINERY_AND_EQUIPMENT').comparisonAmount).toBe(0);
    expect(side(compared, 'ASSETS').comparisonAmount).toBe(2000);
    expect(compared.difference).toEqual({ amount: 0, comparisonAmount: 0 });
  });

  it('keeps an account whose group has no item on its section, as unallocated', () => {
    const loose = buildBalanceSheet(
      [account('1920', 'CURRENT_ASSETS'), account('2000', 'EQUITY', 'SHARE_CAPITAL')],
      { closing: [debit('1920', 700), credit('2000', 700)], beforeFiscalYear: [] },
      null,
    );
    const current = section(loose, 'CURRENT_ASSETS');
    expect(current.amount).toBe(700);
    expect(current.unallocated.amount).toBe(700);
    expect(current.accounts.map((a) => a.accountNumber)).toEqual(['1920']);
    expect(loose.difference.amount).toBe(0);
  });

  it('ignores an item that does not belong to the group main class', () => {
    const wrong = buildBalanceSheet(
      [account('1920', 'CURRENT_ASSETS', 'SHARE_CAPITAL'), account('2000', 'EQUITY', 'SHARE_CAPITAL')],
      { closing: [debit('1920', 700), credit('2000', 700)], beforeFiscalYear: [] },
      null,
    );
    expect(section(wrong, 'CURRENT_ASSETS').unallocated.amount).toBe(700);
    expect(node(wrong, 'SHARE_CAPITAL').amount).toBe(700);
  });

  it('reports ungrouped accounts as unclassified and as the difference', () => {
    const ungrouped = buildBalanceSheet(
      [account('1910', 'CURRENT_ASSETS', 'CASH_AND_BANK'), account('9999', null)],
      { closing: [debit('1910', 250), credit('9999', 250)], beforeFiscalYear: [] },
      null,
    );
    expect(ungrouped.unclassified).toEqual([
      {
        accountId: 'acc-9999',
        accountNumber: '9999',
        accountName: 'Tili 9999',
        amount: -250,
        comparisonAmount: null,
      },
    ]);
    expect(side(ungrouped, 'ASSETS').amount).toBe(250);
    expect(side(ungrouped, 'EQUITY_AND_LIABILITIES').amount).toBe(0);
    expect(ungrouped.difference.amount).toBe(250);
  });

  it('sums in cents', () => {
    const cents = buildBalanceSheet(
      [account('1910', 'CURRENT_ASSETS', 'CASH_AND_BANK'), account('1900', 'CURRENT_ASSETS', 'CASH_AND_BANK')],
      { closing: [debit('1910', 0.1), debit('1900', 0.2)], beforeFiscalYear: [] },
      null,
    );
    expect(node(cents, 'CASH_AND_BANK').amount).toBe(0.3);
  });

  it('rejects an unknown line type instead of signing it', () => {
    expect(() =>
      buildBalanceSheet(
        accounts,
        { closing: [{ accountId: 'acc-1910', type: 'DEBIT', amount: 1 }], beforeFiscalYear: [] },
        null,
      ),
    ).toThrow(/Unknown journal entry line type/);
  });
});
