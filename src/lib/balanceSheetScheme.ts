// The statutory balance sheet layout (tasekaava) of PMA 1753/2015, Annex V, as
// data. Single source of truth for both the balance sheet report and
// account-group validation.
//
// Lettered sections map one-to-one to the balance sheet AccountMainClass
// values; everything a group can be classified as below them to
// BalanceSheetItem values. Order here IS the statutory order.
//
// Deliberately free of Prisma runtime imports (types only) so it stays
// unit-testable without a database.

import type { AccountMainClass, BalanceSheetItem } from '../generated/prisma/client';

// Levels of the layout that carry no postings of their own: the roman-numeral
// groups with numbered items below them, and the long-/short-term halves of
// receivables and liabilities. They are not BalanceSheetItem values because a
// group can't be assigned to them.
//
// The layout asks for the long-term part of receivables and of each liability
// item "separately" (erikseen pitkäaikaiset); it is laid out here the way
// that is done in practice, as a long-term and a short-term block with the
// same numbered items in each.
export type BalanceSheetHeading =
  | 'INTANGIBLE_ASSETS' // A I Aineettomat hyödykkeet
  | 'TANGIBLE_ASSETS' // A II Aineelliset hyödykkeet
  | 'INVESTMENTS' // A III Sijoitukset
  | 'INVENTORIES' // B I Vaihto-omaisuus
  | 'RECEIVABLES' // B II Saamiset
  | 'LONG_TERM_RECEIVABLES'
  | 'SHORT_TERM_RECEIVABLES'
  | 'FINANCIAL_SECURITIES' // B III Rahoitusarvopaperit
  | 'RESERVES' // A IV Muut rahastot
  | 'LONG_TERM_LIABILITIES'
  | 'SHORT_TERM_LIABILITIES';

export interface SchemeItem {
  key: BalanceSheetItem | BalanceSheetHeading;
  // Whether an account group may be classified as this node. False for the
  // headings above.
  assignable: boolean;
  children: SchemeItem[];
}

export interface SchemeClass {
  mainClass: AccountMainClass;
  items: SchemeItem[];
}

export type BalanceSheetSideKey = 'ASSETS' | 'EQUITY_AND_LIABILITIES';

export interface SchemeSide {
  side: BalanceSheetSideKey;
  classes: SchemeClass[];
}

const leaf = (key: BalanceSheetItem): SchemeItem => ({ key, assignable: true, children: [] });

const heading = (key: BalanceSheetHeading, children: BalanceSheetItem[]): SchemeItem => ({
  key,
  assignable: false,
  children: children.map(leaf),
});

export const BALANCE_SHEET_SCHEME: readonly SchemeSide[] = [
  {
    side: 'ASSETS',
    classes: [
      {
        mainClass: 'FIXED_ASSETS',
        items: [
          heading('INTANGIBLE_ASSETS', [
            'DEVELOPMENT_EXPENDITURE',
            'INTANGIBLE_RIGHTS',
            'GOODWILL',
            'OTHER_INTANGIBLE_ASSETS',
            'INTANGIBLE_ADVANCE_PAYMENTS',
          ]),
          heading('TANGIBLE_ASSETS', [
            'LAND_AND_WATERS',
            'BUILDINGS_AND_STRUCTURES',
            'MACHINERY_AND_EQUIPMENT',
            'OTHER_TANGIBLE_ASSETS',
            'TANGIBLE_ADVANCE_PAYMENTS_AND_CONSTRUCTION_IN_PROGRESS',
          ]),
          heading('INVESTMENTS', [
            'INVESTMENT_HOLDINGS_IN_GROUP_UNDERTAKINGS',
            'INVESTMENT_RECEIVABLES_FROM_GROUP_UNDERTAKINGS',
            'INVESTMENT_PARTICIPATING_INTERESTS',
            'INVESTMENT_RECEIVABLES_FROM_PARTICIPATING_INTERESTS',
            'INVESTMENT_OTHER_SHARES_AND_HOLDINGS',
            'INVESTMENT_OTHER_RECEIVABLES',
          ]),
        ],
      },
      {
        mainClass: 'CURRENT_ASSETS',
        items: [
          heading('INVENTORIES', [
            'RAW_MATERIALS_AND_CONSUMABLES',
            'WORK_IN_PROGRESS',
            'FINISHED_GOODS',
            'OTHER_INVENTORIES',
            'INVENTORY_ADVANCE_PAYMENTS',
          ]),
          {
            key: 'RECEIVABLES',
            assignable: false,
            children: [
              heading('LONG_TERM_RECEIVABLES', [
                'LONG_TERM_TRADE_RECEIVABLES',
                'LONG_TERM_RECEIVABLES_FROM_GROUP_UNDERTAKINGS',
                'LONG_TERM_RECEIVABLES_FROM_PARTICIPATING_INTERESTS',
                'LONG_TERM_LOAN_RECEIVABLES',
                'LONG_TERM_OTHER_RECEIVABLES',
                'LONG_TERM_UNPAID_SHARES',
                'LONG_TERM_PREPAYMENTS_AND_ACCRUED_INCOME',
              ]),
              heading('SHORT_TERM_RECEIVABLES', [
                'SHORT_TERM_TRADE_RECEIVABLES',
                'SHORT_TERM_RECEIVABLES_FROM_GROUP_UNDERTAKINGS',
                'SHORT_TERM_RECEIVABLES_FROM_PARTICIPATING_INTERESTS',
                'SHORT_TERM_LOAN_RECEIVABLES',
                'SHORT_TERM_OTHER_RECEIVABLES',
                'SHORT_TERM_UNPAID_SHARES',
                'SHORT_TERM_PREPAYMENTS_AND_ACCRUED_INCOME',
              ]),
            ],
          },
          heading('FINANCIAL_SECURITIES', [
            'SECURITIES_HOLDINGS_IN_GROUP_UNDERTAKINGS',
            'SECURITIES_OTHER_SHARES_AND_HOLDINGS',
            'OTHER_SECURITIES',
          ]),
          leaf('CASH_AND_BANK'),
        ],
      },
    ],
  },
  {
    side: 'EQUITY_AND_LIABILITIES',
    classes: [
      {
        mainClass: 'EQUITY',
        items: [
          leaf('SHARE_CAPITAL'),
          leaf('SHARE_PREMIUM_RESERVE'),
          leaf('REVALUATION_RESERVE'),
          heading('RESERVES', [
            'INVESTED_UNRESTRICTED_EQUITY_RESERVE',
            'RESERVE_FUND',
            'RESERVES_UNDER_ARTICLES',
            'FAIR_VALUE_RESERVE',
            'OTHER_RESERVES',
          ]),
          leaf('RETAINED_EARNINGS'),
          leaf('PROFIT_FOR_THE_FINANCIAL_YEAR'),
        ],
      },
      {
        mainClass: 'ACCUMULATED_APPROPRIATIONS',
        items: [leaf('DEPRECIATION_DIFFERENCE'), leaf('TAX_BASED_PROVISIONS')],
      },
      {
        mainClass: 'PROVISIONS',
        items: [leaf('PENSION_PROVISIONS'), leaf('TAX_PROVISIONS'), leaf('OTHER_PROVISIONS')],
      },
      {
        mainClass: 'LIABILITIES',
        items: [
          heading('LONG_TERM_LIABILITIES', [
            'LONG_TERM_BONDS',
            'LONG_TERM_CONVERTIBLE_BONDS',
            'LONG_TERM_LOANS_FROM_FINANCIAL_INSTITUTIONS',
            'LONG_TERM_PENSION_LOANS',
            'LONG_TERM_ADVANCES_RECEIVED',
            'LONG_TERM_TRADE_PAYABLES',
            'LONG_TERM_BILLS_OF_EXCHANGE_PAYABLE',
            'LONG_TERM_LIABILITIES_TO_GROUP_UNDERTAKINGS',
            'LONG_TERM_LIABILITIES_TO_PARTICIPATING_INTERESTS',
            'LONG_TERM_OTHER_LIABILITIES',
            'LONG_TERM_ACCRUALS_AND_DEFERRED_INCOME',
          ]),
          heading('SHORT_TERM_LIABILITIES', [
            'SHORT_TERM_BONDS',
            'SHORT_TERM_CONVERTIBLE_BONDS',
            'SHORT_TERM_LOANS_FROM_FINANCIAL_INSTITUTIONS',
            'SHORT_TERM_PENSION_LOANS',
            'SHORT_TERM_ADVANCES_RECEIVED',
            'SHORT_TERM_TRADE_PAYABLES',
            'SHORT_TERM_BILLS_OF_EXCHANGE_PAYABLE',
            'SHORT_TERM_LIABILITIES_TO_GROUP_UNDERTAKINGS',
            'SHORT_TERM_LIABILITIES_TO_PARTICIPATING_INTERESTS',
            'SHORT_TERM_OTHER_LIABILITIES',
            'SHORT_TERM_ACCRUALS_AND_DEFERRED_INCOME',
          ]),
        ],
      },
    ],
  },
];

function collectAssignable(nodes: readonly SchemeItem[], into: BalanceSheetItem[]): void {
  for (const node of nodes) {
    if (node.assignable) into.push(node.key as BalanceSheetItem);
    collectAssignable(node.children, into);
  }
}

const ITEMS_BY_CLASS: ReadonlyMap<AccountMainClass, readonly BalanceSheetItem[]> = new Map(
  BALANCE_SHEET_SCHEME.flatMap((side) =>
    side.classes.map((schemeClass) => {
      const items: BalanceSheetItem[] = [];
      collectAssignable(schemeClass.items, items);
      return [schemeClass.mainClass, items] as const;
    }),
  ),
);

export function isBalanceSheetClass(mainClass: AccountMainClass): boolean {
  return ITEMS_BY_CLASS.has(mainClass);
}

// The items a group of this main class may be classified as, in statutory
// order. Empty for income statement classes.
export function balanceSheetItemsOf(mainClass: AccountMainClass): readonly BalanceSheetItem[] {
  return ITEMS_BY_CLASS.get(mainClass) ?? [];
}

export function balanceSheetItemBelongsTo(
  mainClass: AccountMainClass,
  item: BalanceSheetItem,
): boolean {
  return balanceSheetItemsOf(mainClass).includes(item);
}
