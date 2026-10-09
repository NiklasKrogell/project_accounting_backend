import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import {
  addMember,
  createAccount,
  createCashAndBankAccount,
  createTestContext,
} from './helpers';

const app = createApp();

// Checksum-valid IBANs; each test uses its own, as an IBAN is unique within
// the company.
const IBAN = {
  fi: 'FI2112345600000785',
  de: 'DE89370400440532013000',
  gb: 'GB82WEST12345698765432',
  nl: 'NL91ABNA0417164300',
  fr: 'FR1420041010050500013M02606',
  no: 'NO9386011117947',
  se: 'SE4550000000058398257466',
  ee: 'EE382200221020145685',
  lt: 'LT121000011101001000',
  be: 'BE68539007547034',
};

let cookie: string;
let companyId: string;
let accountId: string;

beforeAll(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  accountId = (await createCashAndBankAccount(companyId, 'Pankkitili')).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const create = (body: Record<string, unknown>, as = cookie) =>
  request(app).post('/api/bank-accounts').set('Cookie', as).send(body);
const update = (id: string, body: Record<string, unknown>, as = cookie) =>
  request(app).put(`/api/bank-accounts/${id}`).set('Cookie', as).send(body);

describe('bank accounts', () => {
  it('creates, reads and updates a bank account', async () => {
    const created = await create({ name: ' Yritystili ', iban: 'fi21 1234 5600 0007 85', accountId });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Yritystili',
      iban: IBAN.fi,
      accountId,
      isActive: true,
      account: { id: accountId, name: 'Pankkitili' },
    });
    const id = created.body.data.id as string;

    const got = await request(app).get(`/api/bank-accounts/${id}`).set('Cookie', cookie);
    expect(got.status).toBe(200);
    expect(got.body.data.iban).toBe(IBAN.fi);

    const other = await createCashAndBankAccount(companyId, 'Toinen pankkitili');
    const updated = await update(id, { name: 'Käyttötili', iban: IBAN.de, accountId: other.id });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      name: 'Käyttötili',
      iban: IBAN.de,
      accountId: other.id,
      isActive: true,
    });
  });

  it('takes a bank account out of use and back, and never creates one out of use', async () => {
    const created = await create({ name: 'Säästötili', iban: IBAN.gb, accountId, isActive: false });
    expect(created.status).toBe(201);
    expect(created.body.data.isActive).toBe(true);
    const id = created.body.data.id as string;
    const body = { name: 'Säästötili', iban: IBAN.gb, accountId };

    const deactivated = await update(id, { ...body, isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);

    // An update that does not mention isActive leaves it alone.
    const renamed = await update(id, { ...body, name: 'Vanha säästötili' });
    expect(renamed.body.data).toMatchObject({ name: 'Vanha säästötili', isActive: false });

    const reactivated = await update(id, { ...body, isActive: true });
    expect(reactivated.body.data.isActive).toBe(true);
  });

  it('lists bank accounts in use first, then by name', async () => {
    const other = await createTestContext('ADMIN');
    const account = await createCashAndBankAccount(other.company.id, 'Pankkitili');
    const add = (name: string, iban: string) =>
      create({ name, iban, accountId: account.id }, other.cookie);
    const a = await add('A-tili', IBAN.fi);
    await add('C-tili', IBAN.de);
    await add('B-tili', IBAN.gb);
    await update(
      a.body.data.id,
      { name: 'A-tili', iban: IBAN.fi, accountId: account.id, isActive: false },
      other.cookie,
    );

    const res = await request(app).get('/api/bank-accounts').set('Cookie', other.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { name: string }) => b.name)).toEqual(['B-tili', 'C-tili', 'A-tili']);
  });

  it('rejects a duplicate IBAN with 409, also against one out of use', async () => {
    const first = await create({ name: 'Ensimmäinen', iban: IBAN.nl, accountId });
    expect((await create({ name: 'Sama IBAN', iban: 'nl91 abna 0417 1643 00', accountId })).status).toBe(409);

    const second = await create({ name: 'Toinen', iban: IBAN.fr, accountId });
    expect((await update(second.body.data.id, { name: 'Toinen', iban: IBAN.nl, accountId })).status).toBe(409);

    await update(first.body.data.id, { name: 'Ensimmäinen', iban: IBAN.nl, accountId, isActive: false });
    expect((await create({ name: 'Uudestaan', iban: IBAN.nl, accountId })).status).toBe(409);
  });

  it('allows the same IBAN in another company', async () => {
    await create({ name: 'Oma', iban: IBAN.no, accountId });
    const other = await createTestContext('ADMIN');
    const account = await createCashAndBankAccount(other.company.id, 'Pankkitili');
    const res = await create({ name: 'Vieras', iban: IBAN.no, accountId: account.id }, other.cookie);
    expect(res.status).toBe(201);
  });

  it('rejects an invalid IBAN or an empty name with 400', async () => {
    expect((await create({ name: 'Virhe', iban: 'not-an-iban', accountId })).status).toBe(400);
    // Right shape, wrong checksum.
    expect((await create({ name: 'Virhe', iban: 'FI2212345600000785', accountId })).status).toBe(400);
    expect((await create({ name: '  ', iban: IBAN.se, accountId })).status).toBe(400);
  });

  it("rejects another company's accounting account with 400", async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await createAccount(other.company.id, 'Vieras tili');
    const res = await create({ name: 'Vieras tili', iban: IBAN.se, accountId: foreign.id });
    expect(res.status).toBe(400);
  });

  it('only accepts an account under the balance sheet item CASH_AND_BANK', async () => {
    const ungrouped = await createAccount(companyId, 'Ryhmätön tili');
    const chart = await prisma.chartOfAccounts.findUniqueOrThrow({ where: { companyId } });
    const receivables = await prisma.accountGroup.create({
      data: {
        name: 'Myyntisaamiset',
        mainClass: 'CURRENT_ASSETS',
        balanceSheetItem: 'SHORT_TERM_TRADE_RECEIVABLES',
        companyId,
        chartOfAccountsId: chart.id,
      },
    });
    const receivable = await createAccount(companyId, 'Myyntisaamiset', receivables.id);

    for (const wrong of [ungrouped, receivable]) {
      const res = await create({ name: 'Väärä tili', iban: IBAN.lt, accountId: wrong.id });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(
        'Account must be under the balance sheet item "Cash in hand and at banks"',
      );
    }

    const created = await create({ name: 'Oikea tili', iban: IBAN.lt, accountId });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const moved = await update(id, { name: 'Oikea tili', iban: IBAN.lt, accountId: receivable.id });
    expect(moved.status).toBe(400);
  });

  it('lets a bank account linked to another kind of account be kept and changed', async () => {
    // Linked before the rule, or the account was reclassified afterwards.
    const legacyAccount = await createAccount(companyId, 'Vanha linkitys');
    const legacy = await prisma.bankAccount.create({
      data: { companyId, name: 'Vanha', iban: IBAN.be, accountId: legacyAccount.id },
    });

    const body = { name: 'Vanha tili', iban: IBAN.be, accountId: legacyAccount.id };
    const renamed = await update(legacy.id, { ...body, isActive: false });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: 'Vanha tili', isActive: false });

    const relinked = await update(legacy.id, { ...body, accountId });
    expect(relinked.status).toBe(200);
    // Once moved off it, the old account can't be picked again.
    expect((await update(legacy.id, body)).status).toBe(400);
  });

  it("404s on another company's bank account", async () => {
    const other = await createTestContext('ADMIN');
    const account = await createCashAndBankAccount(other.company.id, 'Pankkitili');
    const foreign = await create({ name: 'Vieras', iban: IBAN.ee, accountId: account.id }, other.cookie);
    const id = foreign.body.data.id as string;

    const get = await request(app).get(`/api/bank-accounts/${id}`).set('Cookie', cookie);
    expect(get.status).toBe(404);
    const put = await update(id, { name: 'Kaapattu', iban: IBAN.ee, accountId });
    expect(put.status).toBe(404);
  });

  it('lets a VIEWER read but not write, and a LEDGER write', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    const list = await request(app).get('/api/bank-accounts').set('Cookie', viewer.cookie);
    expect(list.status).toBe(200);
    expect((await create({ name: 'Ei oikeutta', iban: IBAN.se, accountId }, viewer.cookie)).status).toBe(403);

    const ledger = await addMember(companyId, 'LEDGER');
    const created = await create({ name: 'Oikeus on', iban: IBAN.se, accountId }, ledger.cookie);
    expect(created.status).toBe(201);
    const body = { name: 'Oikeus on', iban: IBAN.se, accountId, isActive: false };
    expect((await update(created.body.data.id, body, viewer.cookie)).status).toBe(403);
    expect((await update(created.body.data.id, body, ledger.cookie)).status).toBe(200);
  });

  it('cannot be deleted, and keeps its accounting account from being deleted', async () => {
    const account = await createCashAndBankAccount(companyId, 'Lukittu pankkitili');
    const created = await create({ name: 'Pysyvä', iban: IBAN.ee, accountId: account.id });
    const id = created.body.data.id as string;

    const del = await request(app).delete(`/api/bank-accounts/${id}`).set('Cookie', cookie);
    expect(del.status).toBe(404);

    // Out of use or not, the bank account still points at the account.
    await update(id, { name: 'Pysyvä', iban: IBAN.ee, accountId: account.id, isActive: false });
    const delAccount = await request(app).delete(`/api/accounts/${account.id}`).set('Cookie', cookie);
    expect(delAccount.status).toBe(409);
  });
});
