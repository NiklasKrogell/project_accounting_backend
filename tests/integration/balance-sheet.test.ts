import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { journalEntryService } from '../../src/services/journal-entry.service';
import { addMember, createTestContext } from './helpers';

const app = createApp();

// The company uses the default chart of accounts, plus one account without a
// group. Fiscal calendar: FY 2024 and FY 2025, all periods OPEN.
//
// Postings:
//   2024-03-01  bank +2500 / share capital -2500
//   2024-06-15  bank +300 / sales -300            (result of 2024: 300)
//   2025-01-01  bank +1000 / sales -1000
//   2025-06-10  wages +400 / bank -400            (result of 2025: 600)
//   2025-07-01  loose +50 / bank -50              (account without a group)
//   2025-12-31  machinery +600 / trade payables -600
let cookie: string;
let companyId: string;
let bankId: string;
let looseId: string;

interface Amounts {
  amount: number;
  comparisonAmount: number | null;
}
interface AccountRow extends Amounts {
  accountId: string;
  accountNumber: string;
  accountName: string;
}
interface Node extends Amounts {
  key: string;
  accounts: AccountRow[];
  derived: Amounts | null;
  children: Node[];
}
interface Section extends Amounts {
  mainClass: string;
  accounts: AccountRow[];
  unallocated: Amounts;
  items: Node[];
}
interface Side extends Amounts {
  side: string;
  classes: Section[];
}
interface SheetBody {
  data: {
    date: string;
    comparisonDate: string | null;
    sides: Side[];
    difference: Amounts;
    unclassified: AccountRow[];
  };
}

const line = (accountId: string, amount: number, type: 'debit' | 'credit') => ({
  accountId,
  amount,
  description: '',
  type,
  vatRate: 0,
});

const sideOf = (body: SheetBody, key: string): Side => {
  const side = body.data.sides.find((s) => s.side === key);
  if (!side) throw new Error(`no side ${key}`);
  return side;
};

const sectionOf = (body: SheetBody, mainClass: string): Section => {
  const section = body.data.sides.flatMap((s) => s.classes).find((c) => c.mainClass === mainClass);
  if (!section) throw new Error(`no section ${mainClass}`);
  return section;
};

const nodeOf = (body: SheetBody, key: string): Node => {
  const walk = (list: Node[]): Node | undefined => {
    for (const node of list) {
      if (node.key === key) return node;
      const nested = walk(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const found = walk(body.data.sides.flatMap((s) => s.classes).flatMap((c) => c.items));
  if (!found) throw new Error(`no item ${key}`);
  return found;
};

const getSheet = (query: Record<string, string>, as = cookie) =>
  request(app).get('/api/balance-sheet').query(query).set('Cookie', as);

async function accountIdsByNumber(company: string): Promise<Record<string, string>> {
  const accounts = await prisma.account.findMany({ where: { companyId: company } });
  return Object.fromEntries(accounts.map((a) => [a.number, a.id]));
}

beforeAll(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;

  const seeded = await request(app).post('/api/chart-of-accounts/initialize').set('Cookie', cookie);
  expect(seeded.status).toBe(201);
  const chart = await prisma.chartOfAccounts.findUniqueOrThrow({ where: { companyId } });
  const loose = await prisma.account.create({
    data: { companyId, chartOfAccountsId: chart.id, number: '9999', name: 'Ryhmätön' },
  });
  looseId = loose.id;

  const ids = await accountIdsByNumber(companyId);
  bankId = ids['1910']!;

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

  await post('2024-03-01', [line(bankId, 2500, 'debit'), line(ids['2000']!, 2500, 'credit')]);
  await post('2024-06-15', [line(bankId, 300, 'debit'), line(ids['3000']!, 300, 'credit')]);
  await post('2025-01-01', [line(bankId, 1000, 'debit'), line(ids['3000']!, 1000, 'credit')]);
  await post('2025-06-10', [line(ids['5000']!, 400, 'debit'), line(bankId, 400, 'credit')]);
  await post('2025-07-01', [line(looseId, 50, 'debit'), line(bankId, 50, 'credit')]);
  await post('2025-12-31', [line(ids['1150']!, 600, 'debit'), line(ids['2700']!, 600, 'credit')]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/balance-sheet', () => {
  it('lays the books out in statutory order, each side in its own sign', async () => {
    const res = await getSheet({ date: '2025-12-31' });
    expect(res.status).toBe(200);
    const body = res.body as SheetBody;

    expect(body.data.date).toBe('2025-12-31');
    expect(body.data.comparisonDate).toBeNull();
    expect(body.data.sides.map((s) => [s.side, s.classes.map((c) => c.mainClass)])).toEqual([
      ['ASSETS', ['FIXED_ASSETS', 'CURRENT_ASSETS']],
      [
        'EQUITY_AND_LIABILITIES',
        ['EQUITY', 'ACCUMULATED_APPROPRIATIONS', 'PROVISIONS', 'LIABILITIES'],
      ],
    ]);

    expect(nodeOf(body, 'MACHINERY_AND_EQUIPMENT').amount).toBe(600);
    expect(nodeOf(body, 'CASH_AND_BANK').amount).toBe(3350);
    expect(nodeOf(body, 'CASH_AND_BANK').accounts.map((a) => a.accountId)).toEqual([bankId]);
    expect(sideOf(body, 'ASSETS').amount).toBe(3950);

    expect(nodeOf(body, 'SHARE_CAPITAL').amount).toBe(2500);
    expect(nodeOf(body, 'SHORT_TERM_TRADE_PAYABLES').amount).toBe(600);
    expect(nodeOf(body, 'SHORT_TERM_LIABILITIES').amount).toBe(600);
    expect(nodeOf(body, 'LONG_TERM_LIABILITIES').amount).toBe(0);
  });

  it('derives the result items of equity from the income statement accounts', async () => {
    const body = (await getSheet({ date: '2025-12-31' })).body as SheetBody;

    const profit = nodeOf(body, 'PROFIT_FOR_THE_FINANCIAL_YEAR');
    expect(profit.amount).toBe(600);
    expect(profit.derived).toEqual({ amount: 600, comparisonAmount: null });
    expect(nodeOf(body, 'RETAINED_EARNINGS').amount).toBe(300);
    expect(sectionOf(body, 'EQUITY').amount).toBe(3400);
    expect(JSON.stringify(body)).not.toContain('"accountNumber":"3000"');
  });

  it('shows the same profit for the year as the income statement', async () => {
    const sheet = (await getSheet({ date: '2025-12-31' })).body as SheetBody;
    const statement = await request(app)
      .get('/api/income-statement')
      .query({ from: '2025-01-01', to: '2025-12-31' })
      .set('Cookie', cookie);
    const profit = (
      statement.body.data.rows as Array<{ kind: string; key?: string; amount: number }>
    ).find((row) => row.key === 'PROFIT_FOR_THE_FINANCIAL_YEAR')!;

    expect(nodeOf(sheet, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(profit.amount);
  });

  it('balances apart from the account that has no group', async () => {
    const body = (await getSheet({ date: '2025-12-31' })).body as SheetBody;

    expect(sideOf(body, 'EQUITY_AND_LIABILITIES').amount).toBe(4000);
    expect(body.data.unclassified).toEqual([
      {
        accountId: looseId,
        accountNumber: '9999',
        accountName: 'Ryhmätön',
        amount: 50,
        comparisonAmount: null,
      },
    ]);
    expect(body.data.difference.amount).toBe(-50);

    // The day before the ungrouped posting the two sides are equal.
    const before = (await getSheet({ date: '2025-06-30' })).body as SheetBody;
    expect(sideOf(before, 'ASSETS').amount).toBe(3400);
    expect(sideOf(before, 'EQUITY_AND_LIABILITIES').amount).toBe(3400);
    expect(before.data.difference.amount).toBe(0);
    expect(before.data.unclassified).toEqual([]);
  });

  it('leaves nothing of a seeded chart unallocated', async () => {
    const body = (await getSheet({ date: '2025-12-31' })).body as SheetBody;
    for (const section of body.data.sides.flatMap((s) => s.classes)) {
      expect(section.accounts, section.mainClass).toEqual([]);
      expect(section.unallocated.amount, section.mainClass).toBe(0);
    }
  });

  it('includes entries dated exactly on the balance sheet date', async () => {
    const onTheDay = (await getSheet({ date: '2025-06-10' })).body as SheetBody;
    expect(nodeOf(onTheDay, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(600);
    expect(nodeOf(onTheDay, 'CASH_AND_BANK').amount).toBe(3400);

    const dayBefore = (await getSheet({ date: '2025-06-09' })).body as SheetBody;
    expect(nodeOf(dayBefore, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(1000);
    expect(nodeOf(dayBefore, 'CASH_AND_BANK').amount).toBe(3800);
  });

  it('starts the result of the year over on the first day of a fiscal year', async () => {
    const lastDay = (await getSheet({ date: '2024-12-31' })).body as SheetBody;
    expect(nodeOf(lastDay, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(300);
    expect(nodeOf(lastDay, 'RETAINED_EARNINGS').amount).toBe(0);

    const firstDay = (await getSheet({ date: '2025-01-01' })).body as SheetBody;
    expect(nodeOf(firstDay, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(1000);
    expect(nodeOf(firstDay, 'RETAINED_EARNINGS').amount).toBe(300);
  });

  it('treats a date after the last fiscal year as the year that follows it', async () => {
    const body = (await getSheet({ date: '2026-03-01' })).body as SheetBody;
    expect(nodeOf(body, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(0);
    expect(nodeOf(body, 'RETAINED_EARNINGS').amount).toBe(900);
    expect(sideOf(body, 'ASSETS').amount).toBe(3950);
  });

  it('is empty before anything was posted', async () => {
    const body = (await getSheet({ date: '2023-12-31' })).body as SheetBody;
    expect(sideOf(body, 'ASSETS').amount).toBe(0);
    expect(sideOf(body, 'EQUITY_AND_LIABILITIES').amount).toBe(0);
    expect(nodeOf(body, 'CASH_AND_BANK').accounts).toEqual([]);
  });

  it('fills the comparison column from the comparison date', async () => {
    const res = await getSheet({ date: '2025-12-31', compareDate: '2024-12-31' });
    expect(res.status).toBe(200);
    const body = res.body as SheetBody;

    expect(body.data.comparisonDate).toBe('2024-12-31');
    expect(nodeOf(body, 'CASH_AND_BANK').comparisonAmount).toBe(2800);
    expect(nodeOf(body, 'PROFIT_FOR_THE_FINANCIAL_YEAR').comparisonAmount).toBe(300);
    expect(nodeOf(body, 'RETAINED_EARNINGS').comparisonAmount).toBe(0);
    // No machinery at the end of 2024: zero, not null, because a comparison
    // was requested.
    expect(nodeOf(body, 'MACHINERY_AND_EQUIPMENT').comparisonAmount).toBe(0);
    expect(sideOf(body, 'ASSETS').comparisonAmount).toBe(2800);
    expect(sideOf(body, 'EQUITY_AND_LIABILITIES').comparisonAmount).toBe(2800);
    expect(body.data.difference).toEqual({ amount: -50, comparisonAmount: 0 });
  });

  it('requires a valid date', async () => {
    expect((await getSheet({})).status).toBe(400);
    expect((await getSheet({ date: '2025-02-30' })).status).toBe(400);
    expect((await getSheet({ date: '2025-12-31', compareDate: 'eilen' })).status).toBe(400);
  });

  it('does not leak the postings of another company', async () => {
    const other = await createTestContext('ADMIN');
    await request(app).post('/api/chart-of-accounts/initialize').set('Cookie', other.cookie);
    const ids = await accountIdsByNumber(other.company.id);
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

    const ours = (await getSheet({ date: '2025-12-31' })).body as SheetBody;
    expect(nodeOf(ours, 'CASH_AND_BANK').amount).toBe(3350);
    expect(JSON.stringify(ours)).not.toContain(ids['1910']!);

    const theirs = (await getSheet({ date: '2025-12-31' }, other.cookie)).body as SheetBody;
    expect(nodeOf(theirs, 'CASH_AND_BANK').amount).toBe(77);
    expect(nodeOf(theirs, 'PROFIT_FOR_THE_FINANCIAL_YEAR').amount).toBe(77);
    expect(JSON.stringify(theirs)).not.toContain(bankId);
  });

  it('allows a VIEWER to read and rejects an unauthenticated request', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    expect((await getSheet({ date: '2025-12-31' }, viewer.cookie)).status).toBe(200);

    const anonymous = await request(app).get('/api/balance-sheet').query({ date: '2025-12-31' });
    expect(anonymous.status).toBe(401);
  });
});
