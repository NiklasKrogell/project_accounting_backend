import { describe, expect, it } from 'vitest';
import { incomeStatementSubItemSchema, mainClassSchema } from '../../src/lib/apiSchemas';
import {
  GROSS_RESULT_CLASSES,
  INCOME_STATEMENT_SCHEME,
  isIncomeStatementClass,
  subItemBelongsTo,
  subItemsOf,
} from '../../src/lib/incomeStatementScheme';

describe('income statement scheme', () => {
  it('lists the numbered items and subtotals in the order of PMA Annex I', () => {
    const order = INCOME_STATEMENT_SCHEME.map((row) =>
      row.kind === 'item' ? row.mainClass : `= ${row.key}`,
    );
    expect(order).toEqual([
      'REVENUE',
      'CHANGE_IN_FINISHED_GOODS_INVENTORIES',
      'PRODUCTION_FOR_OWN_USE',
      'OTHER_OPERATING_INCOME',
      'MATERIALS_AND_SERVICES',
      'PERSONNEL_EXPENSES',
      'DEPRECIATION',
      'OTHER_OPERATING_EXPENSES',
      '= OPERATING_PROFIT',
      'FINANCIAL_INCOME_AND_EXPENSES',
      '= PROFIT_BEFORE_APPROPRIATIONS_AND_TAXES',
      'APPROPRIATIONS',
      'INCOME_TAXES',
      'OTHER_DIRECT_TAXES',
      '= PROFIT_FOR_THE_FINANCIAL_YEAR',
    ]);
  });

  it('orders the items the same way as the main class enum', () => {
    // The chart of accounts sorts by enum order; the two must not disagree.
    const items = INCOME_STATEMENT_SCHEME.flatMap((row) =>
      row.kind === 'item' ? [row.mainClass] : [],
    );
    expect(mainClassSchema.options.slice(0, items.length)).toEqual(items);
  });

  it('places every sub-item under exactly one main class, in enum order', () => {
    const all = mainClassSchema.options.flatMap((mainClass) => subItemsOf(mainClass));
    expect(all).toEqual(incomeStatementSubItemSchema.options);
  });

  it('knows which sub-items belong to which class', () => {
    expect(subItemBelongsTo('PERSONNEL_EXPENSES', 'PENSION_EXPENSES')).toBe(true);
    expect(subItemBelongsTo('REVENUE', 'PENSION_EXPENSES')).toBe(false);
    expect(subItemBelongsTo('FIXED_ASSETS', 'PLANNED_DEPRECIATION')).toBe(false);
    // The "group undertakings" parts are assignable in their own right.
    expect(
      subItemBelongsTo(
        'FINANCIAL_INCOME_AND_EXPENSES',
        'INTEREST_AND_OTHER_FINANCIAL_EXPENSES_GROUP_UNDERTAKINGS',
      ),
    ).toBe(true);
  });

  it('separates income statement classes from balance sheet classes', () => {
    expect(isIncomeStatementClass('OTHER_DIRECT_TAXES')).toBe(true);
    expect(isIncomeStatementClass('REVENUE')).toBe(true);
    expect(isIncomeStatementClass('EQUITY')).toBe(false);
    expect(subItemsOf('EQUITY')).toEqual([]);
  });

  it('defines the gross result as items 1-5', () => {
    expect(GROSS_RESULT_CLASSES).toEqual(mainClassSchema.options.slice(0, 5));
  });
});
