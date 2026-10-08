import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  assertDefaultChartIntegrity,
} from '../../src/lib/defaultChartOfAccounts';
import { mainClassSchema } from '../../src/lib/apiSchemas';
import { isBalanceSheetClass } from '../../src/lib/balanceSheetScheme';
import { subItemsOf } from '../../src/lib/incomeStatementScheme';

describe('default chart of accounts', () => {
  it('has internally consistent data (unique numbers and group names)', () => {
    expect(() => assertDefaultChartIntegrity()).not.toThrow();
  });

  it('detects a duplicate account number', () => {
    const broken = [
      { name: 'A', mainClass: 'REVENUE' as const, accounts: [{ number: '3000', name: 'x' }] },
      { name: 'B', mainClass: 'REVENUE' as const, accounts: [{ number: '3000', name: 'y' }] },
    ];
    expect(() => assertDefaultChartIntegrity(broken)).toThrow(/Duplicate account number/);
  });

  it('detects a duplicate group name', () => {
    const broken = [
      { name: 'Same', mainClass: 'REVENUE' as const, accounts: [{ number: '3000', name: 'x' }] },
      { name: 'Same', mainClass: 'EQUITY' as const, accounts: [{ number: '2000', name: 'y' }] },
    ];
    expect(() => assertDefaultChartIntegrity(broken)).toThrow(/Duplicate group name/);
  });

  it('every account number is numeric and every group non-empty', () => {
    for (const group of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(group.accounts.length).toBeGreaterThan(0);
      for (const account of group.accounts) {
        expect(account.number).toMatch(/^\d+$/);
        expect(account.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers every main class except the two rarely needed income statement items', () => {
    const mainClasses = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((g) => g.mainClass));
    const missing = mainClassSchema.options.filter((c) => !mainClasses.has(c));
    expect(missing).toEqual(['CHANGE_IN_FINISHED_GOODS_INVENTORIES', 'PRODUCTION_FOR_OWN_USE']);
  });

  it('detects a sub-item that does not belong to the group main class', () => {
    const broken = [
      {
        name: 'A',
        mainClass: 'REVENUE' as const,
        subItem: 'PENSION_EXPENSES' as const,
        accounts: [{ number: '3000', name: 'x' }],
      },
    ];
    expect(() => assertDefaultChartIntegrity(broken)).toThrow(/does not belong/);
  });

  it('gives every group of a sub-itemised income statement class a sub-item', () => {
    // Otherwise a freshly seeded chart would show unallocated amounts on the
    // income statement.
    for (const group of DEFAULT_CHART_OF_ACCOUNTS) {
      if (subItemsOf(group.mainClass).length > 0) {
        expect(group.subItem, group.name).toBeDefined();
      }
    }
  });

  it('detects a balance sheet item that does not belong to the group main class', () => {
    const broken = [
      {
        name: 'A',
        mainClass: 'FIXED_ASSETS' as const,
        balanceSheetItem: 'CASH_AND_BANK' as const,
        accounts: [{ number: '1000', name: 'x' }],
      },
    ];
    expect(() => assertDefaultChartIntegrity(broken)).toThrow(/does not belong/);
  });

  it('gives every balance sheet group an item of the balance sheet layout', () => {
    // Otherwise a freshly seeded chart would show unallocated amounts on the
    // balance sheet.
    for (const group of DEFAULT_CHART_OF_ACCOUNTS) {
      if (isBalanceSheetClass(group.mainClass)) {
        expect(group.balanceSheetItem, group.name).toBeDefined();
      } else {
        expect(group.balanceSheetItem, group.name).toBeUndefined();
      }
    }
  });
});
