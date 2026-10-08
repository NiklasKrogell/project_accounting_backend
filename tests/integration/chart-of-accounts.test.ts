import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/defaultChartOfAccounts';
import { addMember, createAccount, createTestContext } from './helpers';

const app = createApp();

const EXPECTED_GROUPS = DEFAULT_CHART_OF_ACCOUNTS.length;
const EXPECTED_ACCOUNTS = DEFAULT_CHART_OF_ACCOUNTS.reduce((sum, g) => sum + g.accounts.length, 0);

let cookie: string;
let companyId: string;

beforeEach(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/chart-of-accounts/initialize', () => {
  it('seeds the default Finnish chart for a fresh company', async () => {
    const res = await request(app)
      .post('/api/chart-of-accounts/initialize')
      .set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(EXPECTED_GROUPS);

    const accountCount = await prisma.account.count({ where: { companyId } });
    const groupCount = await prisma.accountGroup.count({ where: { companyId } });
    expect(accountCount).toBe(EXPECTED_ACCOUNTS);
    expect(groupCount).toBe(EXPECTED_GROUPS);
  });

  it('refuses to re-initialize once the chart exists', async () => {
    await request(app).post('/api/chart-of-accounts/initialize').set('Cookie', cookie);
    const res = await request(app)
      .post('/api/chart-of-accounts/initialize')
      .set('Cookie', cookie);
    expect(res.status).toBe(409);
  });
});

describe('account groups', () => {
  it('creates, updates, and lists groups ordered by main class then name', async () => {
    const created = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Myyntitilit', mainClass: 'REVENUE' });
    expect(created.status).toBe(201);
    expect(created.body.data.mainClass).toBe('REVENUE');

    const updated = await request(app)
      .put(`/api/account-groups/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Liikevaihto', mainClass: 'REVENUE' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Liikevaihto');

    const list = await request(app).get('/api/account-groups').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.map((g: { name: string }) => g.name)).toContain('Liikevaihto');
  });

  it('stores a sub-item that belongs to the main class and clears it when omitted', async () => {
    const created = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({
        name: 'Eläkekulut',
        mainClass: 'PERSONNEL_EXPENSES',
        incomeStatementSubItem: 'PENSION_EXPENSES',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.incomeStatementSubItem).toBe('PENSION_EXPENSES');

    // PUT is a full replace: no sub-item in the body means no sub-item.
    const cleared = await request(app)
      .put(`/api/account-groups/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Eläkekulut', mainClass: 'PERSONNEL_EXPENSES' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.incomeStatementSubItem).toBeNull();
  });

  it('rejects a sub-item of another main class with 400', async () => {
    const created = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({
        name: 'Väärä alakohta',
        mainClass: 'REVENUE',
        incomeStatementSubItem: 'PENSION_EXPENSES',
      });
    expect(created.status).toBe(400);

    const group = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Palkat', mainClass: 'PERSONNEL_EXPENSES' });
    const updated = await request(app)
      .put(`/api/account-groups/${group.body.data.id}`)
      .set('Cookie', cookie)
      .send({
        name: 'Palkat',
        mainClass: 'PERSONNEL_EXPENSES',
        incomeStatementSubItem: 'PLANNED_DEPRECIATION',
      });
    expect(updated.status).toBe(400);
  });

  it('stores a balance sheet item that belongs to the main class and clears it when omitted', async () => {
    const created = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({
        name: 'Poistoero',
        mainClass: 'ACCUMULATED_APPROPRIATIONS',
        balanceSheetItem: 'DEPRECIATION_DIFFERENCE',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.balanceSheetItem).toBe('DEPRECIATION_DIFFERENCE');
    expect(created.body.data.incomeStatementSubItem).toBeNull();

    const cleared = await request(app)
      .put(`/api/account-groups/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Poistoero', mainClass: 'ACCUMULATED_APPROPRIATIONS' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.balanceSheetItem).toBeNull();
  });

  it('rejects a balance sheet item of another main class with 400', async () => {
    const wrongSection = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Väärä erä', mainClass: 'FIXED_ASSETS', balanceSheetItem: 'CASH_AND_BANK' });
    expect(wrongSection.status).toBe(400);

    const onIncomeStatement = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Väärä laskelma', mainClass: 'REVENUE', balanceSheetItem: 'CASH_AND_BANK' });
    expect(onIncomeStatement.status).toBe(400);
  });

  it('accepts the main classes split out of appropriations and taxes', async () => {
    for (const mainClass of ['OTHER_OPERATING_INCOME', 'INCOME_TAXES', 'OTHER_DIRECT_TAXES']) {
      const res = await request(app)
        .post('/api/account-groups')
        .set('Cookie', cookie)
        .send({ name: `Ryhmä ${mainClass}`, mainClass });
      expect(res.status).toBe(201);
    }
    const gone = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Vanha luokka', mainClass: 'APPROPRIATIONS_AND_TAXES' });
    expect(gone.status).toBe(400);
  });

  it('rejects a duplicate group name with 409', async () => {
    await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Kulut', mainClass: 'OTHER_OPERATING_EXPENSES' });
    const dup = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Kulut', mainClass: 'OTHER_OPERATING_EXPENSES' });
    expect(dup.status).toBe(409);
  });

  it('blocks deleting a group that still has accounts', async () => {
    const group = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Pankki', mainClass: 'CURRENT_ASSETS' });
    await request(app)
      .post('/api/accounts')
      .set('Cookie', cookie)
      .send({ number: '1910', name: 'Pankkitili', accountGroupId: group.body.data.id });

    const del = await request(app)
      .delete(`/api/account-groups/${group.body.data.id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(409);
  });
});

describe('accounts', () => {
  it('creates an account, rejects a duplicate number, and filters by main class', async () => {
    const group = await request(app)
      .post('/api/account-groups')
      .set('Cookie', cookie)
      .send({ name: 'Liikevaihto', mainClass: 'REVENUE' });

    const created = await request(app)
      .post('/api/accounts')
      .set('Cookie', cookie)
      .send({ number: '3000', name: 'Myynti', accountGroupId: group.body.data.id });
    expect(created.status).toBe(201);
    expect(created.body.data.accountGroup.mainClass).toBe('REVENUE');

    const dup = await request(app)
      .post('/api/accounts')
      .set('Cookie', cookie)
      .send({ number: '3000', name: 'Toinen myynti' });
    expect(dup.status).toBe(409);

    const byClass = await request(app)
      .get('/api/accounts')
      .query({ mainClass: 'REVENUE' })
      .set('Cookie', cookie);
    expect(byClass.status).toBe(200);
    expect(byClass.body.data).toHaveLength(1);
    expect(byClass.body.data[0].number).toBe('3000');
  });

  it("rejects an account group from another company with 400", async () => {
    const other = await createTestContext('ADMIN');
    const otherGroup = await request(app)
      .post('/api/account-groups')
      .set('Cookie', other.cookie)
      .send({ name: 'Vieras', mainClass: 'REVENUE' });
    const res = await request(app)
      .post('/api/accounts')
      .set('Cookie', cookie)
      .send({ number: '3000', name: 'Myynti', accountGroupId: otherGroup.body.data.id });
    expect(res.status).toBe(400);
  });

  it('blocks deleting an account referenced by a journal entry line', async () => {
    const account = await createAccount(companyId, 'Käytetty tili');
    const other = await createAccount(companyId, 'Vastatili');
    const user = await prisma.user.findFirstOrThrow({
      where: { memberships: { some: { companyId } } },
    });
    await prisma.journalEntry.create({
      data: {
        companyId,
        createdById: user.id,
        voucherType: 'MEMOVOUCHER',
        voucherNumber: 1,
        date: new Date('2025-01-15T00:00:00Z'),
        description: 'Testi',
        accountId: account.id,
        lines: {
          create: [
            { accountId: account.id, amount: 100, description: '', vatRate: 0, vatAmount: 0, type: 'debit' },
            { accountId: other.id, amount: 100, description: '', vatRate: 0, vatAmount: 0, type: 'credit' },
          ],
        },
      },
    });

    const del = await request(app)
      .delete(`/api/accounts/${account.id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(409);
  });

  it('deletes an unused account', async () => {
    const account = await createAccount(companyId, 'Käyttämätön');
    const del = await request(app).delete(`/api/accounts/${account.id}`).set('Cookie', cookie);
    expect(del.status).toBe(204);
  });
});

describe('bank accounts', () => {
  it('creates a bank account, normalizes the IBAN, and enforces uniqueness', async () => {
    const account = await createAccount(companyId, 'Pankkitili');
    const created = await request(app)
      .post('/api/bank-accounts')
      .set('Cookie', cookie)
      .send({ name: 'Yritystili', iban: 'fi21 1234 5600 0007 85', accountId: account.id });
    expect(created.status).toBe(201);
    expect(created.body.data.iban).toBe('FI2112345600000785');

    const dup = await request(app)
      .post('/api/bank-accounts')
      .set('Cookie', cookie)
      .send({ name: 'Sama IBAN', iban: 'FI2112345600000785', accountId: account.id });
    expect(dup.status).toBe(409);
  });

  it('rejects an invalid IBAN with 400', async () => {
    const account = await createAccount(companyId, 'Pankkitili');
    const res = await request(app)
      .post('/api/bank-accounts')
      .set('Cookie', cookie)
      .send({ name: 'Virhe', iban: 'not-an-iban', accountId: account.id });
    expect(res.status).toBe(400);
  });
});

describe('authorization and scoping', () => {
  it('forbids a VIEWER from creating chart entries', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    const res = await request(app)
      .post('/api/account-groups')
      .set('Cookie', viewer.cookie)
      .send({ name: 'Kielletty', mainClass: 'REVENUE' });
    expect(res.status).toBe(403);
  });

  it('allows a VIEWER to read the chart', async () => {
    await request(app).post('/api/chart-of-accounts/initialize').set('Cookie', cookie);
    const viewer = await addMember(companyId, 'VIEWER');
    const res = await request(app).get('/api/accounts').set('Cookie', viewer.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(EXPECTED_ACCOUNTS);
  });

  it("does not expose another company's accounts", async () => {
    const account = await createAccount(companyId, 'Salainen');
    const other = await createTestContext('ADMIN');
    const res = await request(app)
      .get(`/api/accounts/${account.id}`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });
});
