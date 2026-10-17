import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { addMember, createAccount, createSupplier, createTestContext } from './helpers';

const app = createApp();

let cookie: string;
let companyId: string;
let userId: string;

beforeAll(async () => {
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  userId = ctx.user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const create = (body: Record<string, unknown>, as = cookie) =>
  request(app).post('/api/suppliers').set('Cookie', as).send(body);
const update = (id: string, body: Record<string, unknown>, as = cookie) =>
  request(app).put(`/api/suppliers/${id}`).set('Cookie', as).send(body);
const get = (id: string, as = cookie) =>
  request(app).get(`/api/suppliers/${id}`).set('Cookie', as);

// Business IDs are unique per company, so each test that sets one uses its own.
const FULL = {
  name: 'Toimisto Oy',
  businessId: '0112038-9',
  vatNumber: 'FI01120389',
  email: 'laskut@toimisto.example',
  phone: '+358 40 123 4567',
  streetAddress: 'Katu 1',
  postalCode: '00100',
  city: 'Helsinki',
  country: 'FI',
  iban: 'FI21 1234 5600 0007 85',
  bic: 'nda sfihh',
  defaultVatRate: 25.5,
};

describe('suppliers CRUD', () => {
  it('creates, reads, updates and deletes a supplier', async () => {
    const account = await createAccount(companyId, 'Toimistotarvikkeet');
    const created = await create({ ...FULL, defaultAccountId: account.id });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Toimisto Oy',
      businessId: '0112038-9',
      vatNumber: 'FI01120389',
      email: 'laskut@toimisto.example',
      country: 'FI',
      // Stored normalized.
      iban: 'FI2112345600000785',
      bic: 'NDASFIHH',
      defaultAccountId: account.id,
      defaultAccount: { id: account.id, number: account.number, name: 'Toimistotarvikkeet' },
      defaultVatRate: 25.5,
    });
    const id = created.body.data.id as string;

    const got = await get(id);
    expect(got.status).toBe(200);
    expect(got.body.data.name).toBe('Toimisto Oy');

    // A full replace: what is left out is cleared.
    const updated = await update(id, { name: 'Toimisto Oyj', businessId: '0112038-9' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      name: 'Toimisto Oyj',
      businessId: '0112038-9',
      vatNumber: null,
      email: null,
      iban: null,
      bic: null,
      country: 'FI',
      defaultAccountId: null,
      defaultVatRate: null,
    });

    const removed = await request(app).delete(`/api/suppliers/${id}`).set('Cookie', cookie);
    expect(removed.status).toBe(204);
    expect((await get(id)).status).toBe(404);
  });

  it('takes blank optional fields as none', async () => {
    const res = await create({ name: 'Tyhjä Oy', businessId: ' ', email: '', iban: '' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ businessId: null, email: null, iban: null });
  });

  it('lists the suppliers by name and searches name and business ID', async () => {
    const ctx = await createTestContext('ADMIN');
    await create({ name: 'Bravo Oy', businessId: '2617416-4' }, ctx.cookie);
    await create({ name: 'Alfa Oy' }, ctx.cookie);
    await create({ name: 'Charlie Ab', country: 'SE', businessId: '556012-5790' }, ctx.cookie);

    const all = await request(app).get('/api/suppliers').set('Cookie', ctx.cookie);
    expect(all.status).toBe(200);
    expect(all.body.data.map((s: { name: string }) => s.name)).toEqual([
      'Alfa Oy',
      'Bravo Oy',
      'Charlie Ab',
    ]);

    const byName = await request(app)
      .get('/api/suppliers')
      .query({ search: 'alfa' })
      .set('Cookie', ctx.cookie);
    expect(byName.body.data.map((s: { name: string }) => s.name)).toEqual(['Alfa Oy']);
    const byId = await request(app)
      .get('/api/suppliers')
      .query({ search: '2617416' })
      .set('Cookie', ctx.cookie);
    expect(byId.body.data.map((s: { name: string }) => s.name)).toEqual(['Bravo Oy']);
  });
});

describe('supplier validation', () => {
  it('normalizes a Finnish business ID and checks its check digit', async () => {
    const ctx = await createTestContext('ADMIN');
    const ok = await create({ name: 'Vanha muoto Oy', businessId: '737546-2' }, ctx.cookie);
    expect(ok.status).toBe(201);
    expect(ok.body.data.businessId).toBe('0737546-2');

    const wrong = await create({ name: 'Väärä Oy', businessId: '0737546-3' }, ctx.cookie);
    expect(wrong.status).toBe(400);
  });

  it("takes another country's business ID as free text", async () => {
    const res = await create({ name: 'GmbH', country: 'de', businessId: ' HRB 12345 ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ country: 'DE', businessId: 'HRB 12345' });
  });

  it("refuses a Finnish supplier's VAT number that is not its business ID's", async () => {
    const ctx = await createTestContext('ADMIN');
    const mismatch = await create(
      { name: 'Sekaisin Oy', businessId: '1572860-0', vatNumber: 'FI01120389' },
      ctx.cookie,
    );
    expect(mismatch.status).toBe(400);
    const match = await create(
      { name: 'Sopii Oy', businessId: '1572860-0', vatNumber: 'fi 1572 8600' },
      ctx.cookie,
    );
    expect(match.status).toBe(201);
    expect(match.body.data.vatNumber).toBe('FI15728600');
  });

  it.each([
    ['an IBAN with a wrong checksum', { iban: 'FI2212345600000785' }],
    ['a BIC of the wrong shape', { bic: 'NDEA' }],
    ['a VAT number of the wrong shape', { vatNumber: '123' }],
    ['an invalid email', { email: 'ei-sähköposti' }],
    ['a country that is no code', { country: 'Finland' }],
    ['a default VAT rate that is none of the rates', { defaultVatRate: 24 }],
    ['an empty name', { name: '  ' }],
  ])('refuses %s with 400', async (_what, fields) => {
    const res = await create({ name: 'Virhe Oy', ...fields });
    expect(res.status).toBe(400);
  });

  it('refuses a business ID already taken in the company with 409, not in another', async () => {
    const ctx = await createTestContext('ADMIN');
    expect((await create({ name: 'Eka', businessId: '2617416-4' }, ctx.cookie)).status).toBe(201);
    const second = await create({ name: 'Toka', businessId: '2617416-4' }, ctx.cookie);
    expect(second.status).toBe(409);

    const third = await create({ name: 'Kolmas' }, ctx.cookie);
    const renamed = await update(third.body.data.id, { name: 'Kolmas', businessId: '2617416-4' }, ctx.cookie);
    expect(renamed.status).toBe(409);

    const other = await createTestContext('ADMIN');
    expect((await create({ name: 'Eka', businessId: '2617416-4' }, other.cookie)).status).toBe(201);
  });

  it("refuses another company's account as the default with 400", async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await createAccount(other.company.id, 'Vieras tili');
    const res = await create({ name: 'Oletus Oy', defaultAccountId: foreign.id });
    expect(res.status).toBe(400);
  });
});

describe('supplier rules', () => {
  it('clears the default account when the account is deleted', async () => {
    const account = await createAccount(companyId, 'Poistuva tili');
    const created = await create({ name: 'Oletustili Oy', defaultAccountId: account.id });
    const del = await request(app).delete(`/api/accounts/${account.id}`).set('Cookie', cookie);
    expect(del.status).toBe(204);
    expect((await get(created.body.data.id)).body.data.defaultAccountId).toBeNull();
  });

  it('refuses deleting a supplier that has invoices with 409', async () => {
    const supplier = await createSupplier(companyId, 'Laskuttaja Oy');
    await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId: supplier.id,
        invoiceNumber: '1',
        invoiceDate: parseDateOnly('2025-01-01'),
        entryDate: parseDateOnly('2025-01-01'),
        dueDate: parseDateOnly('2025-01-15'),
        createdById: userId,
      },
    });
    const res = await request(app).delete(`/api/suppliers/${supplier.id}`).set('Cookie', cookie);
    expect(res.status).toBe(409);
  });

  it("404s on another company's supplier", async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await createSupplier(other.company.id);
    expect((await get(foreign.id)).status).toBe(404);
    expect((await update(foreign.id, { name: 'Kaapattu' })).status).toBe(404);
    const del = await request(app).delete(`/api/suppliers/${foreign.id}`).set('Cookie', cookie);
    expect(del.status).toBe(404);
  });

  it('lets a VIEWER read but not write, and a LEDGER write', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    expect((await request(app).get('/api/suppliers').set('Cookie', viewer.cookie)).status).toBe(200);
    expect((await create({ name: 'Ei oikeutta' }, viewer.cookie)).status).toBe(403);

    const ledger = await addMember(companyId, 'LEDGER');
    expect((await create({ name: 'Oikeus on' }, ledger.cookie)).status).toBe(201);
  });
});
