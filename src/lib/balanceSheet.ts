// Balance sheet (tase) arithmetic. DB-free like incomeStatement.ts: the
// service does Prisma and tenant scoping, this does 100% of the summing and
// lays the result out in the statutory order of balanceSheetScheme.ts.
//
// Sign convention: each side in its own nature. Assets are DEBIT-POSITIVE,
// equity and liabilities CREDIT-POSITIVE, so every total is a plain sum of
// what is below it and an account with a contra balance shows as negative.
//
// Closing a fiscal year books nothing, so income and expense accounts are
// never emptied into equity. The two result items of equity are therefore
// derived here: the net of the income statement accounts before the fiscal
// year the balance sheet date falls in goes to "Edellisten tilikausien voitto
// (tappio)", the net since then to "Tilikauden voitto (tappio)". Postings made
// directly to accounts classified as those items are added on top.

import type { AccountMainClass, BalanceSheetItem } from '../generated/prisma/client';
import {
  BALANCE_SHEET_SCHEME,
  balanceSheetItemBelongsTo,
  isBalanceSheetClass,
  type BalanceSheetSideKey,
  type SchemeItem,
} from './balanceSheetScheme';
import { fromCents } from './money';
import {
  netCentsByAccount,
  type AccountSideSum,
  type StatementAccountRow,
  type StatementAmounts,
} from './statement';

export interface BalanceSheetAccountInput {
  id: string;
  number: string;
  name: string;
  accountGroup: {
    mainClass: AccountMainClass;
    balanceSheetItem: BalanceSheetItem | null;
  } | null;
}

// The sums one column of the balance sheet is built from.
export interface BalanceSheetColumn {
  // Everything posted up to and including the balance sheet date.
  closing: readonly AccountSideSum[];
  // Everything posted before the fiscal year the date falls in began. Only
  // the income statement accounts' part is used, to split the result.
  beforeFiscalYear: readonly AccountSideSum[];
}

export interface BalanceSheetNode extends StatementAmounts {
  key: SchemeItem['key'];
  // Accounts classified directly as this item (not its children's).
  accounts: StatementAccountRow[];
  // The part of the amount derived from the income statement accounts; set
  // only on the two result items of equity.
  derived: StatementAmounts | null;
  children: BalanceSheetNode[];
}

export interface BalanceSheetClass extends StatementAmounts {
  mainClass: AccountMainClass;
  // Accounts whose group has no (valid) item: postings still to be allocated
  // to one. `unallocated` is their sum.
  accounts: StatementAccountRow[];
  unallocated: StatementAmounts;
  items: BalanceSheetNode[];
}

export interface BalanceSheetSide extends StatementAmounts {
  side: BalanceSheetSideKey;
  classes: BalanceSheetClass[];
}

export interface BalanceSheet {
  // Vastaavaa, then Vastattavaa.
  sides: BalanceSheetSide[];
  // Vastaavaa minus Vastattavaa. Zero unless accounts are unclassified:
  // journal entries balance, so the sides can only differ by what was left
  // out of both.
  difference: StatementAmounts;
  // Accounts with postings but no account group: they have no main class, so
  // they can't be placed on either side. Debit-positive, as in the ledger.
  unclassified: StatementAccountRow[];
}

interface Cents {
  period: number;
  comparison: number;
}

const zero = (): Cents => ({ period: 0, comparison: 0 });

const add = (into: Cents, cents: Cents, sign = 1): void => {
  into.period += sign * cents.period;
  into.comparison += sign * cents.comparison;
};

// `comparison` null means "no comparison column"; a column with no postings
// gives amounts of 0, not null.
export function buildBalanceSheet(
  accounts: readonly BalanceSheetAccountInput[],
  column: BalanceSheetColumn,
  comparison: BalanceSheetColumn | null,
): BalanceSheet {
  const hasComparison = comparison !== null;
  const closing = {
    period: netCentsByAccount(column.closing),
    comparison: netCentsByAccount(comparison?.closing ?? []),
  };
  const before = {
    period: netCentsByAccount(column.beforeFiscalYear),
    comparison: netCentsByAccount(comparison?.beforeFiscalYear ?? []),
  };

  const amounts = (cents: Cents): StatementAmounts => ({
    amount: fromCents(cents.period),
    comparisonAmount: hasComparison ? fromCents(cents.comparison) : null,
  });

  // Only accounts with postings in either column appear. Sorted by number
  // (lexicographic, as everywhere else account numbers are ordered).
  const active = accounts
    .filter((a) => closing.period.has(a.id) || closing.comparison.has(a.id))
    .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));

  // Credit-positive throughout; `sign` turns it into a side's own nature.
  const closingOf = (account: BalanceSheetAccountInput): Cents => ({
    period: closing.period.get(account.id) ?? 0,
    comparison: closing.comparison.get(account.id) ?? 0,
  });
  const beforeOf = (account: BalanceSheetAccountInput): Cents => ({
    period: before.period.get(account.id) ?? 0,
    comparison: before.comparison.get(account.id) ?? 0,
  });

  const accountRow = (account: BalanceSheetAccountInput, sign: number): StatementAccountRow => {
    const cents = zero();
    add(cents, closingOf(account), sign);
    return {
      accountId: account.id,
      accountNumber: account.number,
      accountName: account.name,
      ...amounts(cents),
    };
  };

  const sumAccounts = (list: readonly BalanceSheetAccountInput[], sign: number): Cents => {
    const total = zero();
    for (const account of list) add(total, closingOf(account), sign);
    return total;
  };

  // Balance sheet accounts are bucketed by "mainClass" (no usable item) or
  // "mainClass/item"; an item that doesn't belong to the group's class
  // (possible only if the data was edited around the API) is ignored rather
  // than trusted. Income statement accounts only feed the two result items.
  const buckets = new Map<string, BalanceSheetAccountInput[]>();
  const unclassified: BalanceSheetAccountInput[] = [];
  const earlierResults = zero();
  const resultForTheYear = zero();
  for (const account of active) {
    const group = account.accountGroup;
    if (!group) {
      unclassified.push(account);
      continue;
    }
    if (!isBalanceSheetClass(group.mainClass)) {
      add(earlierResults, beforeOf(account));
      add(resultForTheYear, closingOf(account));
      add(resultForTheYear, beforeOf(account), -1);
      continue;
    }
    const item = group.balanceSheetItem;
    const key =
      item && balanceSheetItemBelongsTo(group.mainClass, item)
        ? `${group.mainClass}/${item}`
        : group.mainClass;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(account);
    else buckets.set(key, [account]);
  }

  const derivedFor = (key: SchemeItem['key']): Cents | null =>
    key === 'RETAINED_EARNINGS'
      ? earlierResults
      : key === 'PROFIT_FOR_THE_FINANCIAL_YEAR'
        ? resultForTheYear
        : null;

  const buildNode = (
    mainClass: AccountMainClass,
    node: SchemeItem,
    sign: number,
  ): { node: BalanceSheetNode; cents: Cents } => {
    const own = buckets.get(`${mainClass}/${node.key}`) ?? [];
    const cents = sumAccounts(own, sign);
    const derived = derivedFor(node.key);
    if (derived) add(cents, derived);
    const children = node.children.map((child) => {
      const built = buildNode(mainClass, child, sign);
      add(cents, built.cents);
      return built.node;
    });
    return {
      node: {
        key: node.key,
        ...amounts(cents),
        accounts: own.map((account) => accountRow(account, sign)),
        derived: derived ? amounts(derived) : null,
        children,
      },
      cents,
    };
  };

  const totals: Cents[] = [];
  const sides = BALANCE_SHEET_SCHEME.map((schemeSide): BalanceSheetSide => {
    const sign = schemeSide.side === 'ASSETS' ? -1 : 1;
    const sideCents = zero();

    const classes = schemeSide.classes.map((schemeClass): BalanceSheetClass => {
      const own = buckets.get(schemeClass.mainClass) ?? [];
      const cents = sumAccounts(own, sign);
      const unallocated = amounts(cents);
      const items = schemeClass.items.map((node) => {
        const built = buildNode(schemeClass.mainClass, node, sign);
        add(cents, built.cents);
        return built.node;
      });
      add(sideCents, cents);
      return {
        mainClass: schemeClass.mainClass,
        ...amounts(cents),
        accounts: own.map((account) => accountRow(account, sign)),
        unallocated,
        items,
      };
    });

    totals.push(sideCents);
    return { side: schemeSide.side, ...amounts(sideCents), classes };
  });

  const difference = zero();
  totals.forEach((cents, index) => add(difference, cents, index === 0 ? 1 : -1));

  return {
    sides,
    difference: amounts(difference),
    unclassified: unclassified.map((account) => accountRow(account, -1)),
  };
}
