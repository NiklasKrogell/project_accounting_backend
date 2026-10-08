// Income statement (tuloslaskelma) arithmetic. DB-free like ledger.ts: the
// service does Prisma and tenant scoping, this does 100% of the summing and
// lays the result out in the statutory order of incomeStatementScheme.ts.
//
// Sign convention: CREDIT-POSITIVE (amount = credits - debits), the opposite
// of the ledger's. Income is therefore positive and expenses negative, which
// makes every total and subtotal a plain sum of what is above it.

import type { AccountMainClass, IncomeStatementSubItem } from '../generated/prisma/client';
import {
  GROSS_RESULT_CLASSES,
  INCOME_STATEMENT_SCHEME,
  subItemBelongsTo,
  type IncomeStatementSubtotal,
  type SchemeSubItem,
} from './incomeStatementScheme';
import { fromCents, toCents } from './money';

// One groupBy(accountId, type) row: the sum of an account's lines on one side.
export interface AccountSideSum {
  accountId: string;
  type: string;
  amount: number;
}

export interface StatementAccountInput {
  id: string;
  number: string;
  name: string;
  accountGroup: {
    mainClass: AccountMainClass;
    incomeStatementSubItem: IncomeStatementSubItem | null;
  } | null;
}

// comparisonAmount is null throughout when no comparison period was requested.
export interface StatementAmounts {
  amount: number;
  comparisonAmount: number | null;
}

export interface StatementAccountRow extends StatementAmounts {
  accountId: string;
  accountNumber: string;
  accountName: string;
}

export interface StatementSubItem extends StatementAmounts {
  key: SchemeSubItem['key'];
  // Accounts classified directly as this sub-item (not its children's).
  accounts: StatementAccountRow[];
  children: StatementSubItem[];
}

export type StatementRow =
  | ({
      kind: 'item';
      mainClass: AccountMainClass;
      // Accounts whose group has no (valid) sub-item. For an item with
      // sub-items these are postings still to be allocated to one, and
      // `unallocated` is their sum (the part of the item's amount that no
      // sub-item explains).
      accounts: StatementAccountRow[];
      unallocated: StatementAmounts;
      subItems: StatementSubItem[];
      // Whether the item is one of those "Bruttotulos" may replace.
      inGrossResult: boolean;
    } & StatementAmounts)
  | ({ kind: 'subtotal'; key: IncomeStatementSubtotal } & StatementAmounts);

export interface IncomeStatement {
  rows: StatementRow[];
  // Items 1-5 combined, for the abridged "Bruttotulos" presentation.
  grossResult: StatementAmounts;
  // Accounts with postings but no account group: they have no main class, so
  // they can't be placed (or even known to be income statement accounts) and
  // are kept out of every total.
  unclassified: StatementAccountRow[];
}

// Net credit-positive cents per account. `type` is a plain String column, so
// an unexpected value must not be silently signed — see ledger.ts signedCents.
function netCentsByAccount(sums: readonly AccountSideSum[]): Map<string, number> {
  const byAccount = new Map<string, number>();
  for (const sum of sums) {
    const cents = toCents(sum.amount);
    let signed: number;
    if (sum.type === 'credit') signed = cents;
    else if (sum.type === 'debit') signed = -cents;
    else throw new Error(`Unknown journal entry line type: ${JSON.stringify(sum.type)}`);
    byAccount.set(sum.accountId, (byAccount.get(sum.accountId) ?? 0) + signed);
  }
  return byAccount;
}

interface Cents {
  period: number;
  comparison: number;
}

// `comparisonSums` null means "no comparison period"; an empty array means a
// comparison period with no postings (amounts are then 0, not null).
export function buildIncomeStatement(
  accounts: readonly StatementAccountInput[],
  periodSums: readonly AccountSideSum[],
  comparisonSums: readonly AccountSideSum[] | null,
): IncomeStatement {
  const hasComparison = comparisonSums !== null;
  const periodCents = netCentsByAccount(periodSums);
  const comparisonCents = netCentsByAccount(comparisonSums ?? []);

  const amounts = (cents: Cents): StatementAmounts => ({
    amount: fromCents(cents.period),
    comparisonAmount: hasComparison ? fromCents(cents.comparison) : null,
  });

  // Only accounts with postings in either period appear. Sorted by number
  // (lexicographic, as everywhere else account numbers are ordered).
  const active = accounts
    .filter((a) => periodCents.has(a.id) || comparisonCents.has(a.id))
    .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));

  const centsOf = (account: StatementAccountInput): Cents => ({
    period: periodCents.get(account.id) ?? 0,
    comparison: comparisonCents.get(account.id) ?? 0,
  });

  const accountRow = (account: StatementAccountInput): StatementAccountRow => ({
    accountId: account.id,
    accountNumber: account.number,
    accountName: account.name,
    ...amounts(centsOf(account)),
  });

  const sumAccounts = (list: readonly StatementAccountInput[]): Cents => {
    const total: Cents = { period: 0, comparison: 0 };
    for (const account of list) {
      const cents = centsOf(account);
      total.period += cents.period;
      total.comparison += cents.comparison;
    }
    return total;
  };

  // Bucket by "mainClass" (no usable sub-item) or "mainClass/subItem". A
  // sub-item that doesn't belong to the group's class (possible only if the
  // data was edited around the API) is ignored rather than trusted, so the
  // account still lands under its main class.
  const buckets = new Map<string, StatementAccountInput[]>();
  const unclassified: StatementAccountInput[] = [];
  for (const account of active) {
    const group = account.accountGroup;
    if (!group) {
      unclassified.push(account);
      continue;
    }
    const subItem = group.incomeStatementSubItem;
    const key =
      subItem && subItemBelongsTo(group.mainClass, subItem)
        ? `${group.mainClass}/${subItem}`
        : group.mainClass;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(account);
    else buckets.set(key, [account]);
  }

  const buildSubItem = (
    mainClass: AccountMainClass,
    node: SchemeSubItem,
  ): { subItem: StatementSubItem; cents: Cents } => {
    const own = buckets.get(`${mainClass}/${node.key}`) ?? [];
    const cents = sumAccounts(own);
    const children = node.children.map((child) => {
      const built = buildSubItem(mainClass, child);
      cents.period += built.cents.period;
      cents.comparison += built.cents.comparison;
      return built.subItem;
    });
    return {
      subItem: { key: node.key, ...amounts(cents), accounts: own.map(accountRow), children },
      cents,
    };
  };

  const running: Cents = { period: 0, comparison: 0 };
  const gross: Cents = { period: 0, comparison: 0 };

  const rows = INCOME_STATEMENT_SCHEME.map((schemeRow): StatementRow => {
    if (schemeRow.kind === 'subtotal') {
      return { kind: 'subtotal', key: schemeRow.key, ...amounts(running) };
    }

    const own = buckets.get(schemeRow.mainClass) ?? [];
    const cents = sumAccounts(own);
    const unallocated = amounts(cents);
    const subItems = schemeRow.subItems.map((node) => {
      const built = buildSubItem(schemeRow.mainClass, node);
      cents.period += built.cents.period;
      cents.comparison += built.cents.comparison;
      return built.subItem;
    });

    running.period += cents.period;
    running.comparison += cents.comparison;
    const inGrossResult = GROSS_RESULT_CLASSES.includes(schemeRow.mainClass);
    if (inGrossResult) {
      gross.period += cents.period;
      gross.comparison += cents.comparison;
    }

    return {
      kind: 'item',
      mainClass: schemeRow.mainClass,
      ...amounts(cents),
      accounts: own.map(accountRow),
      unallocated,
      subItems,
      inGrossResult,
    };
  });

  return {
    rows,
    grossResult: amounts(gross),
    unclassified: unclassified.map(accountRow),
  };
}
