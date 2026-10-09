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

  it('takes the VAT out of the line amount when the amounts are entered gross', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          vatBasis: 'gross',
          lines: [
            { accountId: bankAccountId, amount: 125.5, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 125.5, type: 'credit', vatRate: 25.5 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    // Stored exactly as the net entry of the same sale would be.
    expect(res.body.data.lines).toHaveLength(3);
    const byAccount = new Map<string, LineBody>(
      res.body.data.lines.map((l: LineBody) => [l.accountId, l]),
    );
    expect(byAccount.get(bankAccountId)).toMatchObject({ amount: 125.5, vatAmount: 0 });
    expect(byAccount.get(salesAccountId)).toMatchObject({
      amount: 100,
      vatRate: 25.5,
      vatAmount: 25.5,
      isVat: false,
    });
    expect(byAccount.get(vatPayableAccountId)).toMatchObject({
      amount: 25.5,
      type: 'credit',
      vatRate: 0,
      isVat: true,
    });
  });

  it('keeps a gross entry balanced where the VAT on the net would be a cent off', async () => {
    // 19,91 gross holds 4,05 of VAT; 25,5 % of the 15,86 net would be 4,04.
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          vatBasis: 'gross',
          lines: [
            { accountId: bankAccountId, amount: 19.91, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 19.91, type: 'credit', vatRate: 25.5 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    const byAccount = new Map<string, LineBody>(
      res.body.data.lines.map((l: LineBody) => [l.accountId, l]),
    );
    expect(byAccount.get(salesAccountId)).toMatchObject({ amount: 15.86, vatAmount: 4.05 });
    expect(byAccount.get(vatPayableAccountId)!.amount).toBe(4.05);
  });

  it('rejects net-style amounts sent as gross, and an unknown basis', async () => {
    const unbalanced = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ vatBasis: 'gross' }));
    expect(unbalanced.status).toBe(400);
    expect(unbalanced.body.error.message).toContain('debit 125.50, credit 100.00');

    const unknown = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ vatBasis: 'inclusive' }));
    expect(unknown.status).toBe(400);
  });

  it('generates no VAT rows when automatic VAT is off, and balances the lines as entered', async () => {
    // The VAT is booked by hand, as a line of its own on the VAT account.
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          automaticVat: false,
          lines: [
            { accountId: bankAccountId, amount: 125.5, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5 },
            { accountId: vatPayableAccountId, amount: 25.5, type: 'credit', vatRate: 0 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(3);
    expect(vatRowsOf(res.body)).toHaveLength(0);
    // The rate still describes the sales line.
    const sales = res.body.data.lines.find((l: LineBody) => l.accountId === salesAccountId);
    expect(sales).toMatchObject({ amount: 100, vatRate: 25.5, vatAmount: 25.5, isVat: false });

    // Without the hand-booked VAT line the same entry is out of balance.
    const unbalanced = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(entryBody({ automaticVat: false }));
    expect(unbalanced.status).toBe(400);
    expect(unbalanced.body.error.message).toContain('debit 125.50, credit 100.00');
  });

  it('takes nothing out of the amounts when automatic VAT is off, whatever the basis', async () => {
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', cookie)
      .send(
        entryBody({
          automaticVat: false,
          vatBasis: 'gross',
          lines: [
            { accountId: bankAccountId, amount: 100, type: 'debit', vatRate: 0 },
            { accountId: salesAccountId, amount: 100, type: 'credit', vatRate: 25.5 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(2);
    const sales = res.body.data.lines.find((l: LineBody) => l.accountId === salesAccountId);
    expect(sales.amount).toBe(100);
  });

  it('does not need the VAT accounts when automatic VAT is off', async () => {
    const other = await createTestContext('ADMIN');
    const bank = await createAccount(other.company.id, 'Pankkitili');
    const sales = await createAccount(other.company.id, 'Myynti');
    await fiscalYearService.create(other.company.id, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
    const res = await request(app)
      .post('/api/journal-entries')
      .set('Cookie', other.cookie)
      .send({
        voucherType: 'SALES',
        date: '2025-01-15',
        description: 'Myyntilasku',
        accountId: bank.id,
        automaticVat: false,
        lines: [
          { accountId: bank.id, amount: 100, type: 'debit', vatRate: 0 },
          { accountId: sales.id, amount: 100, type: 'credit', vatRate: 25.5 },
        ],
      });
    expect(res.status).toBe(201);
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

    // An update may switch the basis: 220,00 gross at 10 % is the same entry.
    const gross = await request(app)
      .put(`/api/journal-entries/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({
        date: '2025-01-15',
        description: 'Muutettu',
        accountId: bankAccountId,
        vatBasis: 'gross',
        lines: [
          { accountId: bankAccountId, amount: 220, type: 'debit', vatRate: 0 },
          { accountId: salesAccountId, amount: 220, type: 'credit', vatRate: 10 },
        ],
      });
    expect(gross.status).toBe(200);
    expect(vatRowsOf(gross.body)).toHaveLength(1);
    expect(vatRowsOf(gross.body)[0]).toMatchObject({ amount: 20 });
    expect(
      gross.body.data.lines.find((l: LineBody) => l.accountId === salesAccountId).amount,
    ).toBe(200);

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

// A company of its own, so switching its VAT registration off does not reach
// the rest of the suite. Its VAT accounts are set: only the registration
// stands in the way of a line with VAT.
describe('VAT registration', () => {
  const NOT_REGISTERED = 'The company is not VAT-registered, so entry lines cannot have a VAT rate';
  let other: Awaited<ReturnType<typeof createTestContext>>;
  let bankId: string;
  let salesId: string;
  let payableId: string;

  const body = (overrides: Record<string, unknown> = {}) => ({
    voucherType: 'SALES',
    date: '2025-01-15',
    description: 'Myyntilasku',
    accountId: bankId,
    lines: [
      { accountId: bankId, amount: 125.5, type: 'debit', vatRate: 0 },
      { accountId: salesId, amount: 100, type: 'credit', vatRate: 25.5 },
    ],
    ...overrides,
  });
  const withoutVat = () =>
    body({
      lines: [
        { accountId: bankId, amount: 100, type: 'debit', vatRate: 0 },
        { accountId: salesId, amount: 100, type: 'credit', vatRate: 0 },
      ],
    });
  const post = (payload: Record<string, unknown>) =>
    request(app).post('/api/journal-entries').set('Cookie', other.cookie).send(payload);
  const setVatRegistered = (vatRegistered: boolean) =>
    request(app).patch('/api/settings/company').set('Cookie', other.cookie).send({ vatRegistered });

  beforeAll(async () => {
    other = await createTestContext('ADMIN');
    const otherCompanyId = other.company.id;
    bankId = (await createAccount(otherCompanyId, 'Pankkitili')).id;
    salesId = (await createAccount(otherCompanyId, 'Myynti')).id;
    payableId = (await createAccount(otherCompanyId, 'Arvonlisäverovelka')).id;
    const receivableId = (await createAccount(otherCompanyId, 'Arvonlisäverosaaminen')).id;
    await prisma.chartOfAccounts.update({
      where: { companyId: otherCompanyId },
      data: { vatReceivableAccountId: receivableId, vatPayableAccountId: payableId },
    });
    await fiscalYearService.create(otherCompanyId, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
  });

  it('rejects a line with a VAT rate when the company is not VAT-registered', async () => {
    // Registered by default: the entry is posted with its VAT row.
    const registered = await post(body());
    expect(registered.status).toBe(201);
    expect(vatRowsOf(registered.body)).toHaveLength(1);

    expect((await setVatRegistered(false)).status).toBe(200);
    const rejected = await post(body());
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toBe(NOT_REGISTERED);

    // The rate would only describe the line with automatic VAT off, but a
    // company that books no VAT has no rate to describe either.
    const byHand = await post(
      body({
        automaticVat: false,
        lines: [
          { accountId: bankId, amount: 125.5, type: 'debit', vatRate: 0 },
          { accountId: salesId, amount: 100, type: 'credit', vatRate: 25.5 },
          { accountId: payableId, amount: 25.5, type: 'credit', vatRate: 0 },
        ],
      }),
    );
    expect(byHand.status).toBe(400);
    expect(byHand.body.error.message).toBe(NOT_REGISTERED);

    // Lines without VAT are posted as before, and the entry made while the
    // company was registered keeps its VAT row.
    const plain = await post(withoutVat());
    expect(plain.status).toBe(201);
    expect(vatRowsOf(plain.body)).toHaveLength(0);
    const earlier = await request(app)
      .get(`/api/journal-entries/${registered.body.data.id}`)
      .set('Cookie', other.cookie);
    expect(vatRowsOf(earlier.body)).toHaveLength(1);

    // Registering again lifts the restriction.
    expect((await setVatRegistered(true)).status).toBe(200);
    expect((await post(body())).status).toBe(201);
  });

  it('rejects giving a line a VAT rate when updating an entry', async () => {
    await setVatRegistered(true);
    const created = await post(body());
    expect(created.status).toBe(201);
    await setVatRegistered(false);
    const put = (lines: unknown) =>
      request(app)
        .put(`/api/journal-entries/${created.body.data.id}`)
        .set('Cookie', other.cookie)
        .send({ date: '2025-01-15', description: 'Myyntilasku', accountId: bankId, lines });

    const rejected = await put(body().lines);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toBe(NOT_REGISTERED);

    // Saved without VAT, the entry loses the VAT row it was created with.
    const updated = await put(withoutVat().lines);
    expect(updated.status).toBe(200);
    expect(updated.body.data.lines).toHaveLength(2);
    expect(vatRowsOf(updated.body)).toHaveLength(0);
  });

  it("leaves an account's default VAT rate off the lines when the company is not VAT-registered", async () => {
    // The default only prefills the rate in the UI: a line is stored with the
    // rate it was sent with, never with one derived from its account.
    await prisma.account.update({ where: { id: salesId }, data: { defaultVatRate: 25.5 } });
    await setVatRegistered(false);

    const plain = await post(withoutVat());
    expect(plain.status).toBe(201);
    const lines: LineBody[] = plain.body.data.lines;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.vatRate)).toEqual([0, 0]);
    expect(lines.map((l) => l.vatAmount)).toEqual([0, 0]);
    expect(vatRowsOf(plain.body)).toHaveLength(0);

    // The default itself is left as it is, for when the company registers.
    const account = await request(app).get(`/api/accounts/${salesId}`).set('Cookie', other.cookie);
    expect(account.body.data.defaultVatRate).toBe(25.5);
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
