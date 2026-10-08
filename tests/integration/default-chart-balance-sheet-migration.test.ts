import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { prisma } from '../../src/lib/prisma';
import type { AccountMainClass, BalanceSheetItem } from '../../src/generated/prisma/client';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/defaultChartOfAccounts';
import { isBalanceSheetClass } from '../../src/lib/balanceSheetScheme';
import { createTestContext } from './helpers';
import { TEST_DATABASE_URL } from './testDb';

// The data migration that splits the OLD default chart's balance sheet groups
// into one group per statutory item. As in
// default-chart-split-migration.test.ts, globalSetup has already applied it to
// an empty database, so the test builds an old-style chart and runs the
// migration's SQL again.
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261008150000_split_default_balance_sheet_groups/migration.sql',
  ),
  'utf8',
);

async function runMigration(): Promise<void> {
  // A plain pg client: the file is several statements, which Prisma's
  // prepared-statement path would reject.
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
  } finally {
    await client.end();
  }
}

async function oldStyleGroup(
  companyId: string,
  name: string,
  mainClass: AccountMainClass,
  numbers: string[],
  balanceSheetItem: BalanceSheetItem | null = null,
) {
  const chart = await prisma.chartOfAccounts.findUniqueOrThrow({ where: { companyId } });
  const group = await prisma.accountGroup.create({
    data: { companyId, chartOfAccountsId: chart.id, name, mainClass, balanceSheetItem },
  });
  await prisma.account.createMany({
    data: numbers.map((number) => ({
      companyId,
      chartOfAccountsId: chart.id,
      number,
      name: `Tili ${number}`,
      accountGroupId: group.id,
    })),
  });
  return group;
}

// The balance sheet half of the default chart as it was before the split.
const OLD_DEFAULT_GROUPS: Array<[string, AccountMainClass, string[]]> = [
  ['Aineettomat hyödykkeet', 'FIXED_ASSETS', ['1000', '1010', '1020', '1030']],
  ['Aineelliset hyödykkeet', 'FIXED_ASSETS', ['1100', '1120', '1150', '1180']],
  ['Sijoitukset', 'FIXED_ASSETS', ['1300', '1350']],
  ['Vaihto-omaisuus', 'CURRENT_ASSETS', ['1500', '1540', '1560']],
  ['Saamiset', 'CURRENT_ASSETS', ['1700', '1730', '1750', '1763']],
  ['Rahat ja pankkisaamiset', 'CURRENT_ASSETS', ['1900', '1910']],
  ['Oma pääoma', 'EQUITY', ['2000', '2010', '2040', '2050', '2070', '2080']],
  ['Pakolliset varaukset', 'PROVISIONS', ['2300', '2320']],
  ['Pitkäaikainen vieras pääoma', 'LIABILITIES', ['2600', '2620']],
  [
    'Lyhytaikainen vieras pääoma',
    'LIABILITIES',
    ['2700', '2710', '2730', '2740', '2920', '2925', '2939'],
  ],
];

// number -> [group name, main class, item] for one company.
async function placement(companyId: string) {
  const accounts = await prisma.account.findMany({
    where: { companyId },
    include: { accountGroup: true },
  });
  return Object.fromEntries(
    accounts.map((a) => [
      a.number,
      a.accountGroup
        ? [a.accountGroup.name, a.accountGroup.mainClass, a.accountGroup.balanceSheetItem]
        : null,
    ]),
  );
}

const groupNames = async (companyId: string) =>
  (await prisma.accountGroup.findMany({ where: { companyId } })).map((g) => g.name).sort();

let seeded: string; // a chart exactly as the old default seeded it
let customised: string; // one the company has since changed

beforeAll(async () => {
  seeded = (await createTestContext()).company.id;
  for (const [name, mainClass, numbers] of OLD_DEFAULT_GROUPS) {
    await oldStyleGroup(seeded, name, mainClass, numbers);
  }

  customised = (await createTestContext()).company.id;
  // An account the company added itself sits next to a seeded one.
  await oldStyleGroup(customised, 'Sijoitukset', 'FIXED_ASSETS', ['1350', '1360']);
  // The target name "Ostovelat" is already taken by an unrelated group.
  await oldStyleGroup(customised, 'Ostovelat', 'CURRENT_ASSETS', ['1790']);
  await oldStyleGroup(customised, 'Lyhytaikainen vieras pääoma', 'LIABILITIES', ['2700', '2740']);
  // Same number as a seeded account, but in a group the company made itself.
  await oldStyleGroup(customised, 'Omat koneet', 'FIXED_ASSETS', ['1150']);
  // A second bank account the company added to the default cash group.
  await oldStyleGroup(customised, 'Rahat ja pankkisaamiset', 'CURRENT_ASSETS', ['1910', '1920']);
  // A group the company has already classified itself is not touched.
  await oldStyleGroup(customised, 'Saamiset', 'CURRENT_ASSETS', ['1700'], 'LONG_TERM_TRADE_RECEIVABLES');

  await runMigration();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('split default balance sheet groups migration', () => {
  it('turns an old default chart into the current one', async () => {
    // Every account the old chart had ends up exactly where a fresh seed of
    // the current default chart puts it.
    const expected = Object.fromEntries(
      DEFAULT_CHART_OF_ACCOUNTS.filter((g) => isBalanceSheetClass(g.mainClass)).flatMap((g) =>
        g.accounts.map((a) => [a.number, [g.name, g.mainClass, g.balanceSheetItem]]),
      ),
    );
    // Accounts the old default chart did not have.
    delete expected['2200'];
    delete expected['2250'];

    expect(await placement(seeded)).toEqual(expected);
  });

  it('removes the old groups it emptied', async () => {
    const names = await groupNames(seeded);
    expect(names).toContain('Rahat ja pankkisaamiset');
    for (const [name] of OLD_DEFAULT_GROUPS) {
      if (name !== 'Rahat ja pankkisaamiset') expect(names).not.toContain(name);
    }
  });

  it("leaves a company's own accounts and groups where they are", async () => {
    const placed = await placement(customised);
    expect(placed['1350']).toEqual([
      'Muut osakkeet ja osuudet',
      'FIXED_ASSETS',
      'INVESTMENT_OTHER_SHARES_AND_HOLDINGS',
    ]);
    // Not a seeded account: stays, so its old group stays too.
    expect(placed['1360']).toEqual(['Sijoitukset', 'FIXED_ASSETS', null]);
    // Seeded number, but not in the old default group.
    expect(placed['1150']).toEqual(['Omat koneet', 'FIXED_ASSETS', null]);
    // Already classified by the company.
    expect(placed['1700']).toEqual(['Saamiset', 'CURRENT_ASSETS', 'LONG_TERM_TRADE_RECEIVABLES']);
  });

  it('classifies the cash group in place, own accounts included', async () => {
    const placed = await placement(customised);
    expect(placed['1910']).toEqual(['Rahat ja pankkisaamiset', 'CURRENT_ASSETS', 'CASH_AND_BANK']);
    expect(placed['1920']).toEqual(['Rahat ja pankkisaamiset', 'CURRENT_ASSETS', 'CASH_AND_BANK']);
  });

  it('does not move an account into an unrelated group that has the target name', async () => {
    const placed = await placement(customised);
    // "Ostovelat" already exists as an assets group, so 2700 stays put...
    expect(placed['2700']).toEqual(['Lyhytaikainen vieras pääoma', 'LIABILITIES', null]);
    expect(placed['1790']).toEqual(['Ostovelat', 'CURRENT_ASSETS', null]);
    // ...while 2740, whose target name was free, is still moved.
    expect(placed['2740']).toEqual([
      'Siirtovelat',
      'LIABILITIES',
      'SHORT_TERM_ACCRUALS_AND_DEFERRED_INCOME',
    ]);
  });

  it('changes nothing when run again', async () => {
    const before = [await placement(seeded), await placement(customised)];
    const groupsBefore = [await groupNames(seeded), await groupNames(customised)];
    await runMigration();
    expect([await placement(seeded), await placement(customised)]).toEqual(before);
    expect([await groupNames(seeded), await groupNames(customised)]).toEqual(groupsBefore);
  });
});
