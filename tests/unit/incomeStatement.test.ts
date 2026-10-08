import { describe, expect, it } from 'vitest';
import type { AccountMainClass, IncomeStatementSubItem } from '../../src/generated/prisma/client';
import {
  buildIncomeStatement,
  type AccountSideSum,
  type IncomeStatement,
  type StatementAccountInput,
  type StatementSubItem,
} from '../../src/lib/incomeStatement';

const account = (
  number: string,
  mainClass: AccountMainClass | null,
  subItem: IncomeStatementSubItem | null = null,
): StatementAccountInput => ({
  id: `acc-${number}`,
  number,
  name: `Tili ${number}`,
  accountGroup: mainClass ? { mainClass, incomeStatementSubItem: subItem } : null,
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

function item(statement: IncomeStatement, mainClass: AccountMainClass) {
  const row = statement.rows.find((r) => r.kind === 'item' && r.mainClass === mainClass);
  if (!row || row.kind !== 'item') throw new Error(`no item ${mainClass}`);
  return row;
}

function subtotal(statement: IncomeStatement, key: string) {
  const row = statement.rows.find((r) => r.kind === 'subtotal' && r.key === key);
  if (!row) throw new Error(`no subtotal ${key}`);
  return row;
}

function findSubItem(nodes: StatementSubItem[], key: string): StatementSubItem {
  const walk = (list: StatementSubItem[]): StatementSubItem | undefined => {
    for (const node of list) {
      if (node.key === key) return node;
      const nested = walk(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const found = walk(nodes);
  if (!found) throw new Error(`no sub-item ${key}`);
  return found;
}

const accounts = [
  account('1910', 'CURRENT_ASSETS'),
  account('3000', 'REVENUE'),
  account('3600', 'OTHER_OPERATING_INCOME'),
  account('4000', 'MATERIALS_AND_SERVICES', 'PURCHASES'),
  account('4400', 'MATERIALS_AND_SERVICES', 'CHANGE_IN_INVENTORIES'),
  account('4500', 'MATERIALS_AND_SERVICES', 'EXTERNAL_SERVICES'),
  account('5000', 'PERSONNEL_EXPENSES', 'WAGES_AND_SALARIES'),
  account('5100', 'PERSONNEL_EXPENSES', 'PENSION_EXPENSES'),
  account('7700', 'OTHER_OPERATING_EXPENSES'),
  account('8000', 'FINANCIAL_INCOME_AND_EXPENSES', 'OTHER_INTEREST_AND_FINANCIAL_INCOME'),
  account(
    '8010',
    'FINANCIAL_INCOME_AND_EXPENSES',
    'OTHER_INTEREST_AND_FINANCIAL_INCOME_GROUP_UNDERTAKINGS',
  ),
  account('8200', 'FINANCIAL_INCOME_AND_EXPENSES', 'INTEREST_AND_OTHER_FINANCIAL_EXPENSES'),
  account('9000', 'APPROPRIATIONS', 'CHANGE_IN_DEPRECIATION_DIFFERENCE'),
  account('9200', 'INCOME_TAXES'),
];

const period = [
  debit('1910', 5000),
  credit('3000', 10000),
  debit('3000', 500), // a credit note: revenue nets to 9500
  credit('3600', 200),
  debit('4000', 3000),
  credit('4400', 400), // inventory grew: reduces the expense
  debit('4500', 600),
  debit('5000', 2000),
  debit('5100', 350),
  debit('7700', 1000),
  credit('8000', 30),
  credit('8010', 20),
  debit('8200', 150),
  debit('9000', 100),
  debit('9200', 500),
];

describe('buildIncomeStatement', () => {
  const statement = buildIncomeStatement(accounts, period, null);

  it('presents income as positive and expenses as negative', () => {
    expect(item(statement, 'REVENUE').amount).toBe(9500);
    expect(item(statement, 'OTHER_OPERATING_EXPENSES').amount).toBe(-1000);
  });

  it('sums sub-items into their headings and items', () => {
    const materials = item(statement, 'MATERIALS_AND_SERVICES');
    expect(findSubItem(materials.subItems, 'PURCHASES').amount).toBe(-3000);
    expect(findSubItem(materials.subItems, 'CHANGE_IN_INVENTORIES').amount).toBe(400);
    expect(findSubItem(materials.subItems, 'MATERIALS_SUPPLIES_AND_GOODS').amount).toBe(-2600);
    expect(findSubItem(materials.subItems, 'EXTERNAL_SERVICES').amount).toBe(-600);
    expect(materials.amount).toBe(-3200);
    // Everything is allocated, so nothing hangs directly on the item.
    expect(materials.accounts).toEqual([]);

    const personnel = item(statement, 'PERSONNEL_EXPENSES');
    expect(findSubItem(personnel.subItems, 'SOCIAL_SECURITY_EXPENSES').amount).toBe(-350);
    expect(personnel.amount).toBe(-2350);
  });

  it('includes the group-undertakings part in its parent sub-item', () => {
    const financial = item(statement, 'FINANCIAL_INCOME_AND_EXPENSES');
    const other = findSubItem(financial.subItems, 'OTHER_INTEREST_AND_FINANCIAL_INCOME');
    expect(other.amount).toBe(50);
    expect(other.accounts.map((a) => a.accountNumber)).toEqual(['8000']);
    expect(other.children[0]?.amount).toBe(20);
    expect(financial.amount).toBe(-100);
  });

  it('computes the three subtotals as running sums', () => {
    // 9500 + 200 - 3200 - 2350 - 1000
    expect(subtotal(statement, 'OPERATING_PROFIT').amount).toBe(3150);
    expect(subtotal(statement, 'PROFIT_BEFORE_APPROPRIATIONS_AND_TAXES').amount).toBe(3050);
    expect(subtotal(statement, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(2450);
  });

  it('computes the gross result from items 1-5', () => {
    expect(statement.grossResult.amount).toBe(6500);
    expect(item(statement, 'MATERIALS_AND_SERVICES').inGrossResult).toBe(true);
    expect(item(statement, 'PERSONNEL_EXPENSES').inGrossResult).toBe(false);
  });

  it('returns every item of the layout, including empty ones', () => {
    expect(statement.rows).toHaveLength(15);
    const empty = item(statement, 'PRODUCTION_FOR_OWN_USE');
    expect(empty.amount).toBe(0);
    expect(empty.accounts).toEqual([]);
  });

  it('leaves balance sheet accounts out entirely', () => {
    expect(JSON.stringify(statement)).not.toContain('acc-1910');
    expect(statement.unclassified).toEqual([]);
  });

  it('reports null comparison amounts when no comparison period is given', () => {
    expect(item(statement, 'REVENUE').comparisonAmount).toBeNull();
    expect(subtotal(statement, 'OPERATING_PROFIT').comparisonAmount).toBeNull();
    expect(statement.grossResult.comparisonAmount).toBeNull();
    expect(item(statement, 'REVENUE').accounts[0]?.comparisonAmount).toBeNull();
  });

  it('fills the comparison column, including accounts active only then', () => {
    const compared = buildIncomeStatement(
      accounts,
      [credit('3000', 100)],
      [credit('3000', 80), debit('7700', 30)],
    );
    expect(item(compared, 'REVENUE').amount).toBe(100);
    expect(item(compared, 'REVENUE').comparisonAmount).toBe(80);
    const expenses = item(compared, 'OTHER_OPERATING_EXPENSES');
    expect(expenses.amount).toBe(0);
    expect(expenses.comparisonAmount).toBe(-30);
    expect(expenses.accounts).toEqual([
      {
        accountId: 'acc-7700',
        accountNumber: '7700',
        accountName: 'Tili 7700',
        amount: 0,
        comparisonAmount: -30,
      },
    ]);
    expect(subtotal(compared, 'PROFIT_FOR_THE_FINANCIAL_YEAR').comparisonAmount).toBe(50);
  });

  it('distinguishes an empty comparison period from no comparison', () => {
    const compared = buildIncomeStatement(accounts, [credit('3000', 100)], []);
    expect(item(compared, 'REVENUE').comparisonAmount).toBe(0);
  });

  it('sums in cents so float noise never reaches a total', () => {
    const noisy = buildIncomeStatement(
      [account('3000', 'REVENUE'), account('3001', 'REVENUE'), account('3002', 'REVENUE')],
      [credit('3000', 0.1), credit('3001', 0.2), credit('3002', 0.30000000000000004)],
      null,
    );
    expect(item(noisy, 'REVENUE').amount).toBe(0.6);
    expect(subtotal(noisy, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(0.6);
  });

  it('keeps a group without a sub-item directly under its item, still in the total', () => {
    const partial = buildIncomeStatement(
      [
        account('5000', 'PERSONNEL_EXPENSES', 'WAGES_AND_SALARIES'),
        account('5900', 'PERSONNEL_EXPENSES'),
      ],
      [debit('5000', 100), debit('5900', 40)],
      null,
    );
    const personnel = item(partial, 'PERSONNEL_EXPENSES');
    expect(personnel.accounts.map((a) => a.accountNumber)).toEqual(['5900']);
    expect(personnel.unallocated).toEqual({ amount: -40, comparisonAmount: null });
    expect(personnel.amount).toBe(-140);
  });

  it('ignores a sub-item that does not belong to the group main class', () => {
    const odd = buildIncomeStatement(
      [account('3000', 'REVENUE', 'PENSION_EXPENSES')],
      [credit('3000', 100)],
      null,
    );
    expect(item(odd, 'REVENUE').amount).toBe(100);
    expect(item(odd, 'PERSONNEL_EXPENSES').amount).toBe(0);
  });

  it('lists ungrouped accounts as unclassified and keeps them out of totals', () => {
    const withLoose = buildIncomeStatement(
      [account('3000', 'REVENUE'), account('3999', null)],
      [credit('3000', 100), credit('3999', 25)],
      null,
    );
    expect(withLoose.unclassified.map((a) => [a.accountNumber, a.amount])).toEqual([
      ['3999', 25],
    ]);
    expect(subtotal(withLoose, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(100);
  });

  it('orders accounts by number within an item', () => {
    const ordered = buildIncomeStatement(
      [account('3020', 'REVENUE'), account('3000', 'REVENUE'), account('3010', 'REVENUE')],
      [credit('3020', 1), credit('3000', 1), credit('3010', 1)],
      null,
    );
    expect(item(ordered, 'REVENUE').accounts.map((a) => a.accountNumber)).toEqual([
      '3000',
      '3010',
      '3020',
    ]);
  });

  it('throws on an unrecognised line type rather than guessing a side', () => {
    expect(() =>
      buildIncomeStatement(
        [account('3000', 'REVENUE')],
        [{ accountId: 'acc-3000', type: 'CREDIT', amount: 1 }],
        null,
      ),
    ).toThrow(/Unknown journal entry line type/);
  });
});
