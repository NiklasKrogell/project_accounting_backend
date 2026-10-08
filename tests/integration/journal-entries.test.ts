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
let cookie: string;
let companyId: string;
let salesAccountId: string;
let bankAccountId: string;

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    voucherType: 'SALES',
    date: '2025-01-15',
    description: 'Myyntilasku',
    accountId: bankAccountId,
    lines: [
      { accountId: bankAccountId, amount: 124, type: 'debit', vatRate: 0, vatAmount: 0 },
      { accountId: salesAccountId, amount: 124, type: 'credit', vatRate: 24, vatAmount: 24 },
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
    expect(res.body.data.lines).toHaveLength(2);
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
            { accountId: bankAccountId, amount: 100, type: 'debit', vatRate: 0, vatAmount: 0 },
            { accountId: salesAccountId, amount: 99, type: 'credit', vatRate: 0, vatAmount: 0 },
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
            { accountId: bankAccountId, amount: 124, type: 'debit', vatRate: 0, vatAmount: 0 },
            {
              accountId: salesAccountId,
              amount: 124,
              type: 'credit',
              vatRate: 24,
              vatAmount: 24,
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
              amount: 124,
              type: 'debit',
              vatRate: 0,
              vatAmount: 0,
              costCenterId: foreign.id,
            },
            { accountId: salesAccountId, amount: 124, type: 'credit', vatRate: 24, vatAmount: 24 },
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
          { accountId: bankAccountId, amount: 250, type: 'debit', vatRate: 0, vatAmount: 0 },
          { accountId: salesAccountId, amount: 250, type: 'credit', vatRate: 24, vatAmount: 48.39 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2025-03-20');
    expect(res.body.data.description).toBe('Korjattu kirjaus');
    expect(res.body.data.lines).toHaveLength(2);
    expect(res.body.data.lines[0].amount).toBe(250);
    // Voucher number is preserved across updates.
    expect(res.body.data.voucherNumber).toBe(created.body.data.voucherNumber);

    const lineCount = await prisma.journalEntryLine.count({
      where: { journalEntryId: created.body.data.id },
    });
    expect(lineCount).toBe(2);
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
          { accountId: bankAccountId, amount: 124, type: 'debit', vatRate: 0, vatAmount: 0 },
          {
            accountId: salesAccountId,
            amount: 124,
            type: 'credit',
            vatRate: 24,
            vatAmount: 24,
            costCenterId: costCenter.id,
          },
        ],
      });
    expect(res.status).toBe(200);
    const tagged = res.body.data.lines.filter(
      (l: { costCenterId: string | null }) => l.costCenterId === costCenter.id,
    );
    expect(tagged).toHaveLength(1);
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
