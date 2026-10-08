import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { accountingPeriodService } from '../../src/services/accounting-period.service';
import { addMember, createAccount, createCostCenter, createTestContext } from './helpers';

const app = createApp();

// Fiscal calendar for the suite: FY 2025 with monthly periods, February CLOSED.
// The company has both VAT accounts set, so lines with VAT can be posted.
let cookie: string;
let companyId: string;
let salesAccountId: string;
let bankAccountId: string;
let expenseAccountId: string;
let vatReceivableAccountId: string;
let vatPayableAccountId: string;

interface LineBody {
  accountId: string;
  amount: number;
  type: string;
  vatRate: number;
  vatAmount: number;
  isVat: boolean;
  costCenterId: string | null;
}

const vatRowsOf = (body: { data: { lines: LineBody[] } }) => body.data.lines.filter((l) => l.isVat);

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    voucherType: 'SALES',
    date: '2025-01-15',
    description: 'Myyntilasku',
    accountId: bankAccountId,
    // Amounts are net: 100,00 of sales at 25,5 % is paid as 125,50.
    lines: [
      { accountId: bankAccountId, amount: 125.5, type: 'debit', vatRate: 0 },
      { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5 },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  salesAccountId = (await createAccount(companyId, 'Myynti')).id;
  bankAccountId = (await createAccount(companyId, 'Pankkitili')).id;
  expenseAccountId = (await createAccount(companyId, 'Kulut')).id;
  vatReceivableAccountId = (await createAccount(companyId, 'Arvonlisäverosaaminen')).id;
  vatPayableAccountId = (await createAccount(companyId, 'Arvonlisäverovelka')).id;
  await prisma.chartOfAccounts.update({
    where: { companyId },
    data: { vatReceivableAccountId, vatPayableAccountId },
  });

  const fy = await fiscalYearService.create(companyId, {
    startDate: parseDateOnly('2025-01-01'),
    endDate: parseDateOnly('2025-12-31'),
    granularity: 'MONTH',
  });
  const february = fy.periods.find((p) => p.index === 2)!;
  await accountingPeriodService.closePeriod(companyId, february.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/journal-entries', () => {
  it('creates a balanced entry in an open period with voucher number 1', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    expect(res.status).toBe(201);
    expect(res.body.data.voucherType).toBe('SALES');
    expect(res.body.data.voucherNumber).toBe(1);
    expect(res.body.data.date).toBe('2025-01-15');
    // The two entered lines and the VAT row of the sales line.
    expect(res.body.data.lines).toHaveLength(3);
  });

  it('increments the voucher number within a series and starts a new series at 1', async () => {
    const second = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    expect(second.status).toBe(201);
    expect(second.body.data.voucherNumber).toBe(2);

    const expense = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ voucherType: 'EXPENSE', description: 'Kulu' }));
    expect(expense.status).toBe(201);
    expect(expense.body.data.voucherNumber).toBe(1);
  });

  it('rejects an unbalanced entry with 400', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          lines: [
            { accountId: bankAccountId, amount: 100, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 99, type: 'credit', vatRate: 0 },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('balance');
  });

  it('rejects a date no fiscal year covers with 400', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ date: '2024-06-01' }));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('No fiscal year covers this date');
  });

  it('rejects a date in a closed period with 409', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ date: '2025-02-10' }));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Accounting period is closed');
  });

  it("rejects another company's account with 400", async () => {
    const other = await createTestContext('ADMIN');
    const foreignAccount = await createAccount(other.company.id, 'Vieras tili');
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ accountId: foreignAccount.id }));
    expect(res.status).toBe(400);
  });

  it('stores an optional cost center per line, null when omitted', async () => {
    const costCenter = await createCostCenter(companyId, 'JE-1');
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          lines: [
            { accountId: bankAccountId, amount: 125.5, type: 'debit', vatRate: 0 },
            {
              accountId: salesAccountId,
              amount: 100,
              type: 'credit',
              vatRate: 25.5,
              costCenterId: costCenter.id,
            },
          ],
        }),
      );
    expect(res.status).toBe(201);
    const byAccount = new Map<string, string | null>(
      res.body.data.lines.map((l: { accountId: string; costCenterId: string | null }) => [
        l.accountId,
        l.costCenterId,
      ]),
    );
    expect(byAccount.get(salesAccountId)).toBe(costCenter.id);
    expect(byAccount.get(bankAccountId)).toBeNull();
    // The VAT row has the cost center of the line it came from.
    expect(byAccount.get(vatPayableAccountId)).toBe(costCenter.id);
  });

  it("rejects another company's cost center with 400", async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await createCostCenter(other.company.id, 'JE-1');
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          lines: [
            {
              accountId: bankAccountId,
              amount: 125.5,
              type: 'debit',
              vatRate: 0,
              costCenterId: foreign.id,
            },
            { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5 },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('One or more cost centers do not exist in this company');
  });

  it('rejects creation from a VIEWER with 403', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', viewer.cookie)
      .send(entryBody());
    expect(res.status).toBe(403);
  });

  it('allows creation from a LEDGER member', async () => {
    const ledger = await addMember(companyId, 'LEDGER');
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', ledger.cookie)
      .send(entryBody({ description: 'LEDGER-kirjaus' }));
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/journal-entries/:id', () => {
  it('updates an entry and replaces its lines', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    const res = await request(app)
      .put(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({
        date: '2025-03-20',
        description: 'Korjattu kirjaus',
        accountId: bankAccountId,
        lines: [
          { accountId: bankAccountId, amount: 251, type: 'debit', vatRate: 0 },
          { accountId: salesAccountId, amount: 200, type: 'credit', vatRate: 25.5 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2025-03-20');
    expect(res.body.data.description).toBe('Korjattu kirjaus');
    expect(res.body.data.lines).toHaveLength(3);
    expect(res.body.data.lines[0].amount).toBe(251);
    // Voucher number is preserved across updates.
    expect(res.body.data.voucherNumber).toBe(created.body.data.voucherNumber);

    const lineCount = await prisma.journalEntryLine.count({
      where: { journalEntryId: created.body.data.id },
    });
    expect(lineCount).toBe(3);
  });

  it('replaces the cost centers along with the lines', async () => {
    const costCenter = await createCostCenter(companyId, 'JE-2');
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    const res = await request(app)
      .put(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({
        date: '2025-01-15',
        description: 'Kustannuspaikalla',
        accountId: bankAccountId,
        lines: [
          { accountId: bankAccountId, amount: 125.5, type: 'debit', vatRate: 0 },
          {
            accountId: salesAccountId,
            amount: 100,
            type: 'credit',
            vatRate: 25.5,
            costCenterId: costCenter.id,
          },
        ],
      });
    expect(res.status).toBe(200);
    const tagged = res.body.data.lines.filter(
      (l: { costCenterId: string | null }) => l.costCenterId === costCenter.id,
    );
    // The sales line and the VAT row generated from it.
    expect(tagged).toHaveLength(2);
  });

  it('rejects moving an entry into a closed period with 409', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    const res = await request(app)
      .put(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ ...entryBody({ date: '2025-02-10' }), voucherType: undefined });
    expect(res.status).toBe(409);
  });

  it('rejects editing and deleting an entry whose period has been closed', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ date: '2025-04-10' }));
    const april = await prisma.accountingPeriod.findFirstOrThrow({
      where: { companyId, index: 4 },
    });
    await accountingPeriodService.closePeriod(companyId, april.id);

    const update = await request(app)
      .put(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ ...entryBody({ date: '2025-04-10' }), voucherType: undefined });
    expect(update.status).toBe(409);

    const del = await request(app)
      .delete(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(409);

    await accountingPeriodService.reopenPeriod(companyId, april.id);
  });
});

describe('VAT rows', () => {
  it('posts the VAT of a credit line to the VAT payable account', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    expect(res.status).toBe(201);

    const vatRows = vatRowsOf(res.body);
    expect(vatRows).toHaveLength(1);
    expect(vatRows[0]).toMatchObject({
      accountId: vatPayableAccountId,
      amount: 25.5,
      type: 'credit',
      // The row is the tax itself: no rate or VAT amount of its own.
      vatRate: 0,
      vatAmount: 0,
      costCenterId: null,
    });
    const sales = res.body.data.lines.find((l: LineBody) => l.accountId === salesAccountId);
    expect(sales).toMatchObject({ amount: 100, vatAmount: 25.5, isVat: false });
  });

  it('posts the VAT of a debit line to the VAT receivable account', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          voucherType: 'PURCHASE',
          description: 'Ostolasku',
          lines: [
            { accountId: expenseAccountId, amount: 200, type: 'debit', vatRate: 13.5 },
            { accountId: bankAccountId, amount: 227, type: 'credit', vatRate: 0 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    const vatRows = vatRowsOf(res.body);
    expect(vatRows).toHaveLength(1);
    expect(vatRows[0]).toMatchObject({
      accountId: vatReceivableAccountId,
      amount: 27,
      type: 'debit',
      vatRate: 0,
    });
  });

  it('computes the VAT itself and ignores a vatAmount or isVat sent by the client', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          lines: [
            { accountId: bankAccountId, amount: 125.5, type: 'debit', vatRate: 0, isVat: true },
            { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5, vatAmount: 999 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(3);
    const byAccount = new Map<string, LineBody>(
      res.body.data.lines.map((l: LineBody) => [l.accountId, l]),
    );
    expect(byAccount.get(bankAccountId)!.isVat).toBe(false);
    expect(byAccount.get(salesAccountId)!.vatAmount).toBe(25.5);
    expect(byAccount.get(vatPayableAccountId)!.amount).toBe(25.5);
  });

  it('rejects an entry that balances only when its VAT is left out', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          lines: [
            { accountId: bankAccountId, amount: 100, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5 },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('debit 100.00, credit 125.50');
  });

  it('generates no VAT row for an entry without VAT', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          lines: [
            { accountId: bankAccountId, amount: 100, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 0 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(2);
    expect(vatRowsOf(res.body)).toHaveLength(0);
  });

  it('regenerates the VAT rows on update instead of adding to them', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    const put = (lines: unknown[]) =>
      request(app)
        .put(`/api/journal-entries/${created.body.data.id}`)
        .set('Cookie', cookie)
        .send({ date: '2025-01-15', description: 'Muutettu', accountId: bankAccountId, lines });

    const changed = await put([
      { accountId: bankAccountId, amount: 220, type: 'debit', vatRate: 0 },
      { accountId: salesAccountId, amount: 200, type: 'credit', vatRate: 10 },
    ]);
    expect(changed.status).toBe(200);
    expect(vatRowsOf(changed.body)).toHaveLength(1);
    expect(vatRowsOf(changed.body)[0]).toMatchObject({ amount: 20, vatRate: 0 });

    const withoutVat = await put([
      { accountId: bankAccountId, amount: 200, type: 'debit', vatRate: 0 },
      { accountId: salesAccountId, amount: 200, type: 'credit', vatRate: 0 },
    ]);
    expect(withoutVat.status).toBe(200);
    expect(withoutVat.body.data.lines).toHaveLength(2);
    const stored = await prisma.journalEntryLine.count({
      where: { journalEntryId: created.body.data.id, isVat: true },
    });
    expect(stored).toBe(0);
  });

  it('shows the VAT row on the VAT account in the general ledger', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ date: '2025-06-10' }));
    const res = await request(app)
      .get('/api/general-ledger')
      .query({ accountId: vatPayableAccountId, from: '2025-06-01', to: '2025-06-30' })
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const ledger = res.body.data[0];
    expect(ledger.accountId).toBe(vatPayableAccountId);
    expect(ledger.creditTotal).toBe(25.5);
    expect(ledger.lines).toHaveLength(1);
    expect(ledger.lines[0]).toMatchObject({
      entryId: created.body.data.id,
      credit: 25.5,
      debit: 0,
      isVat: true,
    });
  });

  it('rejects a line with VAT when the VAT account of its side is not set', async () => {
    const other = await createTestContext('ADMIN');
    const bank = await createAccount(other.company.id, 'Pankkitili');
    const sales = await createAccount(other.company.id, 'Myynti');
    const receivable = await createAccount(other.company.id, 'Arvonlisäverosaaminen');
    await fiscalYearService.create(other.company.id, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
    // Only the receivable account is set: a credit line with VAT needs the
    // payable one.
    await prisma.chartOfAccounts.update({
      where: { companyId: other.company.id },
      data: { vatReceivableAccountId: receivable.id },
    });
    const body = (vatRate: number, bankAmount: number) => ({
      voucherType: 'SALES',
      date: '2025-01-15',
      description: 'Myyntilasku',
      accountId: bank.id,
      lines: [
        { accountId: bank.id, amount: bankAmount, type: 'debit', vatRate: 0 },
        { accountId: sales.id, amount: 100, type: 'credit', vatRate },
      ],
    });

    const withVat = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', other.cookie)
      .send(body(25.5, 125.5));
    expect(withVat.status).toBe(400);
    expect(withVat.body.error.message).toBe(
      'VAT payable account is not set in the chart of accounts',
    );
    // Nothing was stored, and the voucher number was not consumed.
    const withoutVat = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', other.cookie)
      .send(body(0, 100));
    expect(withoutVat.status).toBe(201);
    expect(withoutVat.body.data.voucherNumber).toBe(1);
  });
});

describe('DELETE /api/journal-entries/:id', () => {
  it('deletes an entry in an open period along with its lines', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    const res = await request(app)
      .delete(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(204);

    const lineCount = await prisma.journalEntryLine.count({
      where: { journalEntryId: created.body.data.id },
    });
    expect(lineCount).toBe(0);
  });
});

describe('GET /api/journal-entries', () => {
  it('is company-scoped: another company cannot read the entry', async () => {
    const created = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody());
    const other = await createTestContext('ADMIN');
    const res = await request(app)
      .get(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });

  it('filters by voucher type and date range', async () => {
    const res = await request(app)
      .get('/api/journal-entries')
      .query({ voucherType: 'EXPENSE', from: '2025-01-01', to: '2025-01-31' })
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const entry of res.body.data) {
      expect(entry.voucherType).toBe('EXPENSE');
      expect(entry.date >= '2025-01-01' && entry.date <= '2025-01-31').toBe(true);
    }
    expect(res.body.meta.total).toBe(res.body.data.length);
  });
});
