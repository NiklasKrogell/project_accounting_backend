// The statutory expense-nature income statement layout (kululajikohtainen
// tuloslaskelma) of PMA 1753/2015, Annex I, as data. Single source of truth for
// both the income statement report and account-group validation.
//
// Numbered items map one-to-one to AccountMainClass values; lettered sub-items
// to IncomeStatementSubItem values. Order here IS the statutory order.
//
// Deliberately free of Prisma runtime imports (types only) so it stays
// unit-testable without a database.

import type { AccountMainClass, IncomeStatementSubItem } from '../generated/prisma/client';

// Grouping levels of the layout that carry no postings of their own
// ("a) Aineet, tarvikkeet ja tavarat", "b) Henkilösivukulut"). They are not
// IncomeStatementSubItem values because a group can't be assigned to them.
export type SubItemHeading = 'MATERIALS_SUPPLIES_AND_GOODS' | 'SOCIAL_SECURITY_EXPENSES';

export interface SchemeSubItem {
  key: IncomeStatementSubItem | SubItemHeading;
  // Whether an account group may be classified directly as this node. False
  // only for the pure headings above. A node can be assignable AND have
  // children: 10 c, d and g hold their own postings plus a separately shown
  // "group undertakings" part.
  assignable: boolean;
  children: SchemeSubItem[];
}

export type IncomeStatementSubtotal =
  | 'OPERATING_PROFIT' // 9. Liikevoitto (-tappio)
  | 'PROFIT_BEFORE_APPROPRIATIONS_AND_TAXES' // 11.
  | 'PROFIT_FOR_THE_FINANCIAL_YEAR'; // 15. Tilikauden voitto (tappio)

export type SchemeRow =
  | { kind: 'item'; mainClass: AccountMainClass; subItems: SchemeSubItem[] }
  // A subtotal is the running sum of every item above it.
  | { kind: 'subtotal'; key: IncomeStatementSubtotal };

const leaf = (key: IncomeStatementSubItem): SchemeSubItem => ({
  key,
  assignable: true,
  children: [],
});

const heading = (key: SubItemHeading, children: SchemeSubItem[]): SchemeSubItem => ({
  key,
  assignable: false,
  children,
});

const withGroupUndertakings = (
  key: IncomeStatementSubItem,
  groupKey: IncomeStatementSubItem,
): SchemeSubItem => ({ key, assignable: true, children: [leaf(groupKey)] });

const item = (mainClass: AccountMainClass, subItems: SchemeSubItem[] = []): SchemeRow => ({
  kind: 'item',
  mainClass,
  subItems,
});

export const INCOME_STATEMENT_SCHEME: readonly SchemeRow[] = [
  item('REVENUE'),
  item('CHANGE_IN_FINISHED_GOODS_INVENTORIES'),
  item('PRODUCTION_FOR_OWN_USE'),
  item('OTHER_OPERATING_INCOME'),
  item('MATERIALS_AND_SERVICES', [
    heading('MATERIALS_SUPPLIES_AND_GOODS', [leaf('PURCHASES'), leaf('CHANGE_IN_INVENTORIES')]),
    leaf('EXTERNAL_SERVICES'),
  ]),
  item('PERSONNEL_EXPENSES', [
    leaf('WAGES_AND_SALARIES'),
    heading('SOCIAL_SECURITY_EXPENSES', [
      leaf('PENSION_EXPENSES'),
      leaf('OTHER_SOCIAL_SECURITY_EXPENSES'),
    ]),
  ]),
  item('DEPRECIATION', [
    leaf('PLANNED_DEPRECIATION'),
    leaf('IMPAIRMENT_OF_FIXED_ASSETS'),
    leaf('EXCEPTIONAL_IMPAIRMENT_OF_CURRENT_ASSETS'),
  ]),
  item('OTHER_OPERATING_EXPENSES'),
  { kind: 'subtotal', key: 'OPERATING_PROFIT' },
  item('FINANCIAL_INCOME_AND_EXPENSES', [
    leaf('INCOME_FROM_GROUP_UNDERTAKINGS'),
    leaf('INCOME_FROM_PARTICIPATING_INTERESTS'),
    withGroupUndertakings(
      'INCOME_FROM_OTHER_FIXED_ASSET_INVESTMENTS',
      'INCOME_FROM_OTHER_FIXED_ASSET_INVESTMENTS_GROUP_UNDERTAKINGS',
    ),
    withGroupUndertakings(
      'OTHER_INTEREST_AND_FINANCIAL_INCOME',
      'OTHER_INTEREST_AND_FINANCIAL_INCOME_GROUP_UNDERTAKINGS',
    ),
    leaf('IMPAIRMENT_OF_FIXED_ASSET_INVESTMENTS'),
    leaf('IMPAIRMENT_OF_CURRENT_ASSET_SECURITIES'),
    withGroupUndertakings(
      'INTEREST_AND_OTHER_FINANCIAL_EXPENSES',
      'INTEREST_AND_OTHER_FINANCIAL_EXPENSES_GROUP_UNDERTAKINGS',
    ),
  ]),
  { kind: 'subtotal', key: 'PROFIT_BEFORE_APPROPRIATIONS_AND_TAXES' },
  item('APPROPRIATIONS', [
    leaf('CHANGE_IN_DEPRECIATION_DIFFERENCE'),
    leaf('CHANGE_IN_TAX_BASED_PROVISIONS'),
    leaf('GROUP_CONTRIBUTION'),
  ]),
  item('INCOME_TAXES'),
  item('OTHER_DIRECT_TAXES'),
  { kind: 'subtotal', key: 'PROFIT_FOR_THE_FINANCIAL_YEAR' },
];

// Items 1-5, which a small or micro undertaking may present combined as a
// single "Bruttotulos" item (PMA 2:1.2 §, 4:1 §).
export const GROSS_RESULT_CLASSES: readonly AccountMainClass[] = [
  'REVENUE',
  'CHANGE_IN_FINISHED_GOODS_INVENTORIES',
  'PRODUCTION_FOR_OWN_USE',
  'OTHER_OPERATING_INCOME',
  'MATERIALS_AND_SERVICES',
];

function collectAssignable(nodes: readonly SchemeSubItem[], into: IncomeStatementSubItem[]): void {
  for (const node of nodes) {
    if (node.assignable) into.push(node.key as IncomeStatementSubItem);
    collectAssignable(node.children, into);
  }
}

const SUB_ITEMS_BY_CLASS: ReadonlyMap<AccountMainClass, readonly IncomeStatementSubItem[]> =
  new Map(
    INCOME_STATEMENT_SCHEME.flatMap((row) => {
      if (row.kind !== 'item') return [];
      const subItems: IncomeStatementSubItem[] = [];
      collectAssignable(row.subItems, subItems);
      return [[row.mainClass, subItems] as const];
    }),
  );

export function isIncomeStatementClass(mainClass: AccountMainClass): boolean {
  return SUB_ITEMS_BY_CLASS.has(mainClass);
}

// The sub-items a group of this main class may be classified as, in statutory
// order. Empty for balance sheet classes and for items without sub-items.
export function subItemsOf(mainClass: AccountMainClass): readonly IncomeStatementSubItem[] {
  return SUB_ITEMS_BY_CLASS.get(mainClass) ?? [];
}

export function subItemBelongsTo(
  mainClass: AccountMainClass,
  subItem: IncomeStatementSubItem,
): boolean {
  return subItemsOf(mainClass).includes(subItem);
}
