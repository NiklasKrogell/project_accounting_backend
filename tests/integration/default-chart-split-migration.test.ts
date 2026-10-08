import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { prisma } from '../../src/lib/prisma';
import type { AccountMainClass } from '../../src/generated/prisma/client';
import { createTestContext } from './helpers';
import { TEST_DATABASE_URL } from './testDb';

// The data migration that splits the OLD default chart's income statement
// groups into one group per statutory sub-item. globalSetup has already
// applied it (to an empty database, where it matches nothing), so the test
// builds an old-style chart and runs the migration's SQL again — which is
// exactly what re-running it on a live database would do.
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261008130000_split_default_income_statement_groups/migration.sql',
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
  accounts: Array<[number: string, name: string]>,
) {
  const chart = await prisma.chartOfAccounts.findUniqueOrThrow({ where: { companyId } });
  const group = await prisma.accountGroup.create({
    data: { companyId, chartOfAccountsId: chart.id, name, mainClass },
  });
  await prisma.account.createMany({
    data: accounts.map(([number, accountName]) => ({
      companyId,
      chartOfAccountsId: chart.id,
      number,
      name: accountName,
      accountGroupId: group.id,
    })),
  });
  return group;
}

// number -> [group name, main class, sub-item] for one company.
async function placement(companyId: string) {
  const accounts = await prisma.account.findMany({
    where: { companyId },
    include: { accountGroup: true },
  });
  return Object.fromEntries(
    accounts.map((a) => [
      a.number,
      a.accountGroup
        ? [a.accountGroup.name, a.accountGroup.mainClass, a.accountGroup.incomeStatementSubItem]
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
  await oldStyleGroup(seeded, 'Liikevaihto', 'REVENUE', [['3000', 'Myynti']]);
  await oldStyleGroup(seeded, 'Materiaalit ja palvelut', 'MATERIALS_AND_SERVICES', [
    ['4000', 'Ostot tilikauden aikana'],
    ['4400', 'Varastojen muutos'],
    ['4500', 'Ulkopuoliset palvelut'],
  ]);
  await oldStyleGroup(seeded, 'Henkilöstökulut', 'PERSONNEL_EXPENSES', [
    ['5000', 'Palkat ja palkkiot'],
    ['5100', 'Eläkekulut'],
    ['5200', 'Muut henkilösivukulut'],
  ]);
  await oldStyleGroup(seeded, 'Poistot ja arvonalentumiset', 'DEPRECIATION', [
    ['6800', 'Suunnitelman mukaiset poistot'],
  ]);
  await oldStyleGroup(seeded, 'Rahoitustuotot ja -kulut', 'FINANCIAL_INCOME_AND_EXPENSES', [
    ['8000', 'Korkotuotot'],
    ['8100', 'Muut rahoitustuotot'],
    ['8200', 'Korkokulut'],
    ['8300', 'Muut rahoituskulut'],
  ]);
  // The class the previous migration renamed APPROPRIATIONS_AND_TAXES to.
  await oldStyleGroup(seeded, 'Tilinpäätössiirrot ja verot', 'APPROPRIATIONS', [
    ['9000', 'Poistoeron muutos'],
    ['9200', 'Tuloverot'],
    ['9300', 'Muut välittömät verot'],
  ]);

  customised = (await createTestContext()).company.id;
  // An account the company added itself sits next to the seeded ones.
  await oldStyleGroup(customised, 'Materiaalit ja palvelut', 'MATERIALS_AND_SERVICES', [
    ['4000', 'Ostot tilikauden aikana'],
    ['4010', 'Oma ostotili'],
  ]);
  // The target name "Tuloverot" is already taken by an unrelated group.
  await oldStyleGroup(customised, 'Tuloverot', 'LIABILITIES', [['2950', 'Verovelka']]);
  await oldStyleGroup(customised, 'Tilinpäätössiirrot ja verot', 'APPROPRIATIONS', [
    ['9200', 'Tuloverot'],
    ['9300', 'Muut välittömät verot'],
  ]);
  // Same number as a seeded account, but in a group the company made itself.
  await oldStyleGroup(customised, 'Omat palkat', 'PERSONNEL_EXPENSES', [['5000', 'Palkat']]);

  await runMigration();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('split default income statement groups migration', () => {
  it('moves every seeded account under its statutory sub-item', async () => {
    expect(await placement(seeded)).toEqual({
      '3000': ['Liikevaihto', 'REVENUE', null],
      '4000': ['Ostot tilikauden aikana', 'MATERIALS_AND_SERVICES', 'PURCHASES'],
      '4400': ['Varastojen muutos', 'MATERIALS_AND_SERVICES', 'CHANGE_IN_INVENTORIES'],
      '4500': ['Ulkopuoliset palvelut', 'MATERIALS_AND_SERVICES', 'EXTERNAL_SERVICES'],
      '5000': ['Palkat ja palkkiot', 'PERSONNEL_EXPENSES', 'WAGES_AND_SALARIES'],
      '5100': ['Eläkekulut', 'PERSONNEL_EXPENSES', 'PENSION_EXPENSES'],
      '5200': ['Muut henkilösivukulut', 'PERSONNEL_EXPENSES', 'OTHER_SOCIAL_SECURITY_EXPENSES'],
      '6800': ['Suunnitelman mukaiset poistot', 'DEPRECIATION', 'PLANNED_DEPRECIATION'],
      '8000': [
        'Muut korko- ja rahoitustuotot',
        'FINANCIAL_INCOME_AND_EXPENSES',
        'OTHER_INTEREST_AND_FINANCIAL_INCOME',
      ],
      '8100': [
        'Muut korko- ja rahoitustuotot',
        'FINANCIAL_INCOME_AND_EXPENSES',
        'OTHER_INTEREST_AND_FINANCIAL_INCOME',
      ],
      '8200': [
        'Korkokulut ja muut rahoituskulut',
        'FINANCIAL_INCOME_AND_EXPENSES',
        'INTEREST_AND_OTHER_FINANCIAL_EXPENSES',
      ],
      '8300': [
        'Korkokulut ja muut rahoituskulut',
        'FINANCIAL_INCOME_AND_EXPENSES',
        'INTEREST_AND_OTHER_FINANCIAL_EXPENSES',
      ],
      '9000': ['Poistoeron muutos', 'APPROPRIATIONS', 'CHANGE_IN_DEPRECIATION_DIFFERENCE'],
      '9200': ['Tuloverot', 'INCOME_TAXES', null],
      '9300': ['Muut välittömät verot', 'OTHER_DIRECT_TAXES', null],
    });
  });

  it('removes the old groups it emptied and keeps the rest', async () => {
    expect(await groupNames(seeded)).toEqual(
      [
        'Eläkekulut',
        'Korkokulut ja muut rahoituskulut',
        'Liikevaihto',
        'Muut henkilösivukulut',
        'Muut korko- ja rahoitustuotot',
        'Muut välittömät verot',
        'Ostot tilikauden aikana',
        'Palkat ja palkkiot',
        'Poistoeron muutos',
        'Suunnitelman mukaiset poistot',
        'Tuloverot',
        'Ulkopuoliset palvelut',
        'Varastojen muutos',
      ].sort(),
    );
  });

  it("leaves a company's own accounts and groups where they are", async () => {
    const placed = await placement(customised);
    expect(placed['4000']).toEqual([
      'Ostot tilikauden aikana',
      'MATERIALS_AND_SERVICES',
      'PURCHASES',
    ]);
    // Not a seeded account: stays, so its old group stays too.
    expect(placed['4010']).toEqual(['Materiaalit ja palvelut', 'MATERIALS_AND_SERVICES', null]);
    // Seeded number, but not in the old default group.
    expect(placed['5000']).toEqual(['Omat palkat', 'PERSONNEL_EXPENSES', null]);
    expect(await groupNames(customised)).toContain('Materiaalit ja palvelut');
  });

  it('does not move an account into an unrelated group that has the target name', async () => {
    const placed = await placement(customised);
    // "Tuloverot" already exists as a liabilities group, so 9200 stays put...
    expect(placed['9200']).toEqual(['Tilinpäätössiirrot ja verot', 'APPROPRIATIONS', null]);
    expect(placed['2950']).toEqual(['Tuloverot', 'LIABILITIES', null]);
    // ...while 9300, whose target name was free, is still moved.
    expect(placed['9300']).toEqual(['Muut välittömät verot', 'OTHER_DIRECT_TAXES', null]);
  });

  it('changes nothing when run again', async () => {
    const before = [await placement(seeded), await placement(customised)];
    const groupsBefore = [await groupNames(seeded), await groupNames(customised)];
    await runMigration();
    expect([await placement(seeded), await placement(customised)]).toEqual(before);
    expect([await groupNames(seeded), await groupNames(customised)]).toEqual(groupsBefore);
  });
});
