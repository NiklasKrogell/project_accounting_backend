import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import type { AccountMainClass, IncomeStatementSubItem } from '../../src/generated/prisma/client';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { journalEntryService } from '../../src/services/journal-entry.service';
import { addMember, createTestContext } from './helpers';

const app = createApp();

// Fiscal calendar: FY 2024 and FY 2025, all periods OPEN. The report ignores
// fiscal state; the years only make the fixture entries bookable.
//
// Postings:
//   2024-06-15  bank +300 / sales -300          (comparison year)
//   2025-01-01  bank +1000 / sales -1000        (exactly `from`)
//   2025-06-10  loose +50 / bank -50            (account without a group)
//   2025-12-31  wages +400 / bank -400          (exactly `to`)
//   2026 has no fiscal year, so nothing can be posted after `to`; the
//   boundary is exercised by narrowing the range instead.
let cookie: string;
let companyId: string;
let salesId: string;
let wagesId: string;
let looseId: string;

interface AccountRow {
  accountId: string;
  accountNumber: string;
  amount: number;
  comparisonAmount: number | null;
}
interface SubItemRow {
  key: string;
  amount: number;
  comparisonAmount: number | null;
  accounts: AccountRow[];
  children: SubItemRow[];
}
interface Row {
  kind: 'item' | 'subtotal';
  mainClass?: string;
  key?: string;
  amount: number;
  comparisonAmount: number | null;
  accounts?: AccountRow[];
  subItems?: SubItemRow[];
}
interface StatementBody {
  data: {
    period: { from: string; to: string };
    comparison: { from: string; to: string } | null;
    rows: Row[];
    grossResult: { amount: number; comparisonAmount: number | null };
    unclassified: AccountRow[];
  };
}

async function seedAccounts(
  company: string,
  defs: Array<{
    number: string;
    name: string;
    mainClass?: AccountMainClass;
    subItem?: IncomeStatementSubItem;
  }>,
) {
  const chart = await prisma.chartOfAccounts.findUniqueOrThrow({ where: { companyId: company } });
  const ids: Record<string, string> = {};
  for (const def of defs) {
    const group = def.mainClass
      ? await prisma.accountGroup.create({
          data: {
            companyId: company,
            chartOfAccountsId: chart.id,
            name: `Ryhmä ${def.number}`,
            mainClass: def.mainClass,
            incomeStatementSubItem: def.subItem ?? null,
          },
        })
      : null;
    const account = await prisma.account.create({
      data: {
        companyId: company,
        chartOfAccountsId: chart.id,
        number: def.number,
        name: def.name,
        accountGroupId: group?.id ?? null,
      },
    });
    ids[def.number] = account.id;
  }
  return ids;
}

const line = (accountId: string, amount: number, type: 'debit' | 'credit') => ({
  accountId,
  amount,
  description: '',
  type,
  vatRate: 0,
  vatAmount: 0,
});

const itemOf = (body: StatementBody, mainClass: string): Row => {
  const row = body.data.rows.find((r) => r.kind === 'item' && r.mainClass === mainClass);
  if (!row) throw new Error(`no item ${mainClass}`);
  return row;
};

const subtotalOf = (body: StatementBody, key: string): Row => {
  const row = body.data.rows.find((r) => r.kind === 'subtotal' && r.key === key);
  if (!row) throw new Error(`no subtotal ${key}`);
  return row;
};

const fy2025 = { from: '2025-01-01', to: '2025-12-31' };
const fy2024 = { compareFrom: '2024-01-01', compareTo: '2024-12-31' };

const getStatement = (query: Record<string, string>, as = cookie) =>
  request(app).get('/api/income-statement').query(query).set('Cookie', as);

beforeAll(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;

  const ids = await seedAccounts(companyId, [
    { number: '1910', name: 'Pankkitili', mainClass: 'CURRENT_ASSETS' },
    { number: '3000', name: 'Myynti', mainClass: 'REVENUE' },
    {
      number: '5000',
      name: 'Palkat',
      mainClass: 'PERSONNEL_EXPENSES',
      subItem: 'WAGES_AND_SALARIES',
    },
    { number: '9999', name: 'Ryhmätön' },
  ]);
  const bankId = ids['1910']!;
  salesId = ids['3000']!;
  wagesId = ids['5000']!;
  looseId = ids['9999']!;

  for (const year of [2024, 2025]) {
    await fiscalYearService.create(companyId, {
      startDate: parseDateOnly(`${year}-01-01`),
      endDate: parseDateOnly(`${year}-12-31`),
      granularity: 'MONTH',
    });
  }

  const post = (date: string, lines: ReturnType<typeof line>[]) =>
    journalEntryService.create(companyId, ctx.user.id, {
      voucherType: 'MEMOVOUCHER',
      date: parseDateOnly(date),
      description: 'Testikirjaus',
      accountId: bankId,
      lines,
    });

  await post('2024-06-15', [line(bankId, 300, 'debit'), line(salesId, 300, 'credit')]);
  await post('2025-01-01', [line(bankId, 1000, 'debit'), line(salesId, 1000, 'credit')]);
  await post('2025-06-10', [line(looseId, 50, 'debit'), line(bankId, 50, 'credit')]);
  await post('2025-12-31', [line(wagesId, 400, 'debit'), line(bankId, 400, 'credit')]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/income-statement', () => {
  it('lays the period out in statutory order with credit-positive amounts', async () => {
    const res = await getStatement(fy2025);
    expect(res.status).toBe(200);
    const body = res.body as StatementBody;

    expect(body.data.period).toEqual(fy2025);
    expect(body.data.comparison).toBeNull();
    expect(body.data.rows).toHaveLength(15);
    expect(body.data.rows[0]!.mainClass).toBe('REVENUE');
    expect(body.data.rows.at(-1)!.key).toBe('PROFIT_FOR_THE_FINANCIAL_YEAR');

    expect(itemOf(body, 'REVENUE').amount).toBe(1000);
    expect(itemOf(body, 'REVENUE').accounts!.map((a) => a.accountId)).toEqual([salesId]);

    const personnel = itemOf(body, 'PERSONNEL_EXPENSES');
    expect(personnel.amount).toBe(-400);
    expect(personnel.subItems![0]!.key).toBe('WAGES_AND_SALARIES');
    expect(personnel.subItems![0]!.accounts.map((a) => a.accountId)).toEqual([wagesId]);

    expect(subtotalOf(body, 'OPERATING_PROFIT').amount).toBe(600);
    expect(subtotalOf(body, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(600);
    expect(body.data.grossResult.amount).toBe(1000);
  });

  it('includes entries dated exactly `from` and exactly `to`', async () => {
    const firstDay = await getStatement({ from: '2025-01-01', to: '2025-01-01' });
    expect(itemOf(firstDay.body, 'REVENUE').amount).toBe(1000);

    const lastDay = await getStatement({ from: '2025-12-31', to: '2025-12-31' });
    expect(itemOf(lastDay.body, 'PERSONNEL_EXPENSES').amount).toBe(-400);

    // One day short on each side drops both boundary entries.
    const inside = await getStatement({ from: '2025-01-02', to: '2025-12-30' });
    expect(itemOf(inside.body, 'REVENUE').amount).toBe(0);
    expect(itemOf(inside.body, 'PERSONNEL_EXPENSES').amount).toBe(0);
  });

  it('leaves balance sheet accounts out', async () => {
    const res = await getStatement(fy2025);
    expect(JSON.stringify(res.body)).not.toContain('"accountNumber":"1910"');
  });

  it('reports ungrouped accounts as unclassified, outside every total', async () => {
    const res = await getStatement(fy2025);
    const body = res.body as StatementBody;
    expect(body.data.unclassified).toEqual([
      {
        accountId: looseId,
        accountNumber: '9999',
        accountName: 'Ryhmätön',
        amount: -50,
        comparisonAmount: null,
      },
    ]);
    // 600, not 550: the unclassified debit is not netted into the result.
    expect(subtotalOf(body, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(600);
  });

  it('fills the comparison column from the comparison range', async () => {
    const res = await getStatement({ ...fy2025, ...fy2024 });
    expect(res.status).toBe(200);
    const body = res.body as StatementBody;

    expect(body.data.comparison).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(itemOf(body, 'REVENUE').amount).toBe(1000);
    expect(itemOf(body, 'REVENUE').comparisonAmount).toBe(300);
    // No wages in 2024: zero, not null, because a comparison was requested.
    expect(itemOf(body, 'PERSONNEL_EXPENSES').comparisonAmount).toBe(0);
    expect(subtotalOf(body, 'PROFIT_FOR_THE_FINANCIAL_YEAR').comparisonAmount).toBe(300);
    expect(body.data.grossResult.comparisonAmount).toBe(300);
  });

  it('shows an account that only moved in the comparison period', async () => {
    const res = await getStatement({
      from: '2025-12-01',
      to: '2025-12-31',
      ...fy2024,
    });
    const revenue = itemOf(res.body, 'REVENUE');
    expect(revenue.amount).toBe(0);
    expect(revenue.accounts).toEqual([
      {
        accountId: salesId,
        accountNumber: '3000',
        accountName: 'Myynti',
        amount: 0,
        comparisonAmount: 300,
      },
    ]);
  });

  it('requires the period', async () => {
    expect((await getStatement({})).status).toBe(400);
    expect((await getStatement({ from: '2025-01-01' })).status).toBe(400);
  });

  it('rejects inverted and half-given ranges', async () => {
    const inverted = await getStatement({ from: '2025-03-01', to: '2025-02-01' });
    expect(inverted.status).toBe(400);
    expect(JSON.stringify(inverted.body)).toMatch(/after to/);

    const half = await getStatement({ ...fy2025, compareFrom: '2024-01-01' });
    expect(half.status).toBe(400);
    expect(JSON.stringify(half.body)).toMatch(/together/);

    const invertedComparison = await getStatement({
      ...fy2025,
      compareFrom: '2024-12-31',
      compareTo: '2024-01-01',
    });
    expect(invertedComparison.status).toBe(400);
  });

  it('does not leak the postings of another company', async () => {
    const other = await createTestContext('ADMIN');
    const ids = await seedAccounts(other.company.id, [
      { number: '1910', name: 'Vieras pankki', mainClass: 'CURRENT_ASSETS' },
      { number: '3000', name: 'Vieras myynti', mainClass: 'REVENUE' },
    ]);
    await fiscalYearService.create(other.company.id, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
    await journalEntryService.create(other.company.id, other.user.id, {
      voucherType: 'MEMOVOUCHER',
      date: parseDateOnly('2025-02-10'),
      description: 'Vieras kirjaus',
      accountId: ids['1910']!,
      lines: [line(ids['1910']!, 77, 'debit'), line(ids['3000']!, 77, 'credit')],
    });

    const ours = await getStatement(fy2025);
    expect(itemOf(ours.body, 'REVENUE').amount).toBe(1000);
    expect(JSON.stringify(ours.body)).not.toContain(ids['3000']!);

    const theirs = await getStatement(fy2025, other.cookie);
    expect(itemOf(theirs.body, 'REVENUE').amount).toBe(77);
    expect(JSON.stringify(theirs.body)).not.toContain(salesId);
  });

  it('allows a VIEWER to read and rejects an unauthenticated request', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    expect((await getStatement(fy2025, viewer.cookie)).status).toBe(200);

    const anonymous = await request(app).get('/api/income-statement').query(fy2025);
    expect(anonymous.status).toBe(401);
  });
});
