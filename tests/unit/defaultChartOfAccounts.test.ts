import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  assertDefaultChartIntegrity,
} from '../../src/lib/defaultChartOfAccounts';

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

  it('covers all twelve account main classes', () => {
    const mainClasses = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((g) => g.mainClass));
    expect(mainClasses.size).toBe(12);
  });
});
