import { describe, expect, it } from 'vitest';
import { balanceSheetItemSchema, mainClassSchema } from '../../src/lib/apiSchemas';
import {
  BALANCE_SHEET_SCHEME,
  balanceSheetItemBelongsTo,
  balanceSheetItemsOf,
  isBalanceSheetClass,
} from '../../src/lib/balanceSheetScheme';
import { isIncomeStatementClass } from '../../src/lib/incomeStatementScheme';

describe('balance sheet scheme', () => {
  it('lists the lettered sections of both sides in the order of PMA Annex V', () => {
    expect(
      BALANCE_SHEET_SCHEME.map((side) => [side.side, side.classes.map((c) => c.mainClass)]),
    ).toEqual([
      ['ASSETS', ['FIXED_ASSETS', 'CURRENT_ASSETS']],
      [
        'EQUITY_AND_LIABILITIES',
        ['EQUITY', 'ACCUMULATED_APPROPRIATIONS', 'PROVISIONS', 'LIABILITIES'],
      ],
    ]);
  });

  it('orders the sections the same way as the main class enum', () => {
    // The chart of accounts sorts by enum order; the two must not disagree.
    const sections = BALANCE_SHEET_SCHEME.flatMap((side) => side.classes.map((c) => c.mainClass));
    expect(mainClassSchema.options.slice(-sections.length)).toEqual(sections);
  });

  it('makes every main class either an income statement or a balance sheet class', () => {
    for (const mainClass of mainClassSchema.options) {
      expect(isBalanceSheetClass(mainClass), mainClass).toBe(!isIncomeStatementClass(mainClass));
    }
  });

  it('places every item under exactly one main class, in enum order', () => {
    const all = mainClassSchema.options.flatMap((mainClass) => balanceSheetItemsOf(mainClass));
    expect(all).toEqual(balanceSheetItemSchema.options);
  });

  it('has the roman-numeral groups of each section in statutory order', () => {
    const top = (mainClass: string) =>
      BALANCE_SHEET_SCHEME.flatMap((side) => side.classes)
        .find((c) => c.mainClass === mainClass)!
        .items.map((node) => node.key);

    expect(top('FIXED_ASSETS')).toEqual(['INTANGIBLE_ASSETS', 'TANGIBLE_ASSETS', 'INVESTMENTS']);
    expect(top('CURRENT_ASSETS')).toEqual([
      'INVENTORIES',
      'RECEIVABLES',
      'FINANCIAL_SECURITIES',
      'CASH_AND_BANK',
    ]);
    expect(top('EQUITY')).toEqual([
      'SHARE_CAPITAL',
      'SHARE_PREMIUM_RESERVE',
      'REVALUATION_RESERVE',
      'RESERVES',
      'RETAINED_EARNINGS',
      'PROFIT_FOR_THE_FINANCIAL_YEAR',
    ]);
    expect(top('LIABILITIES')).toEqual(['LONG_TERM_LIABILITIES', 'SHORT_TERM_LIABILITIES']);
  });

  it('gives receivables and liabilities the same items long-term and short-term', () => {
    const strip = (items: readonly string[], prefix: string) =>
      items.filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length));

    for (const mainClass of ['CURRENT_ASSETS', 'LIABILITIES'] as const) {
      const items = balanceSheetItemsOf(mainClass);
      expect(strip(items, 'LONG_TERM_')).toEqual(strip(items, 'SHORT_TERM_'));
    }
    expect(balanceSheetItemsOf('LIABILITIES')).toHaveLength(22);
  });

  it('knows which items belong to which class', () => {
    expect(balanceSheetItemBelongsTo('CURRENT_ASSETS', 'CASH_AND_BANK')).toBe(true);
    expect(balanceSheetItemBelongsTo('FIXED_ASSETS', 'CASH_AND_BANK')).toBe(false);
    expect(balanceSheetItemBelongsTo('REVENUE', 'CASH_AND_BANK')).toBe(false);
    expect(balanceSheetItemsOf('REVENUE')).toEqual([]);
  });
});
