import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { journalEntryService } from '../../src/services/journal-entry.service';
import { addMember, createAccount, createCostCenter, createTestContext } from './helpers';

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
  request(app).post('/api/cost-centers').set('Cookie', as).send(body);

describe('cost centers CRUD', () => {
  it('creates, reads, updates and deletes a cost center', async () => {
    const created = await create({ code: ' 100 ', name: 'Myynti' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: '100', name: 'Myynti' });
    const id = created.body.data.id as string;

    const got = await request(app).get(`/api/cost-centers/${id}`).set('Cookie', cookie);
    expect(got.status).toBe(200);
    expect(got.body.data.code).toBe('100');

    const updated = await request(app)
      .put(`/api/cost-centers/${id}`)
      .set('Cookie', cookie)
      .send({ code: '110', name: 'Myynti ja markkinointi' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ code: '110', name: 'Myynti ja markkinointi' });

    const removed = await request(app).delete(`/api/cost-centers/${id}`).set('Cookie', cookie);
    expect(removed.status).toBe(204);
    const gone = await request(app).get(`/api/cost-centers/${id}`).set('Cookie', cookie);
    expect(gone.status).toBe(404);
  });

  it('lists the company cost centers ordered by code', async () => {
    await create({ code: '300', name: 'Hallinto' });
    await create({ code: '200', name: 'Tuotanto' });
    const res = await request(app).get('/api/cost-centers').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const codes = res.body.data.map((c: { code: string }) => c.code);
    expect(codes).toEqual([...codes].sort());
    expect(codes).toEqual(expect.arrayContaining(['200', '300']));
  });

  it('rejects a duplicate code with 409, on create and on update', async () => {
    await create({ code: '400', name: 'Ensimmäinen' });
    const duplicate = await create({ code: '400', name: 'Toinen' });
    expect(duplicate.status).toBe(409);

    const other = await create({ code: '401', name: 'Kolmas' });
    const renamed = await request(app)
      .put(`/api/cost-centers/${other.body.data.id}`)
      .set('Cookie', cookie)
      .send({ code: '400', name: 'Kolmas' });
    expect(renamed.status).toBe(409);
  });

  it('allows the same code in another company', async () => {
    await create({ code: '500', name: 'Oma' });
    const other = await createTestContext('ADMIN');
    const res = await create({ code: '500', name: 'Vieras' }, other.cookie);
    expect(res.status).toBe(201);
  });

  it('rejects an empty code or name with 400', async () => {
    expect((await create({ code: '', name: 'Nimi' })).status).toBe(400);
    expect((await create({ code: '600', name: '  ' })).status).toBe(400);
  });

  it("404s on another company's cost center", async () => {
    const other = await createTestContext('ADMIN');
    const foreign = await createCostCenter(other.company.id, '700');
    const get = await request(app).get(`/api/cost-centers/${foreign.id}`).set('Cookie', cookie);
    expect(get.status).toBe(404);
    const put = await request(app)
      .put(`/api/cost-centers/${foreign.id}`)
      .set('Cookie', cookie)
      .send({ code: '700', name: 'Kaapattu' });
    expect(put.status).toBe(404);
    const del = await request(app).delete(`/api/cost-centers/${foreign.id}`).set('Cookie', cookie);
    expect(del.status).toBe(404);
  });

  it('lets a VIEWER read but not write, and a LEDGER write', async () => {
    const viewer = await addMember(companyId, 'VIEWER');
    const list = await request(app).get('/api/cost-centers').set('Cookie', viewer.cookie);
    expect(list.status).toBe(200);
    expect((await create({ code: '800', name: 'Ei oikeutta' }, viewer.cookie)).status).toBe(403);

    const ledger = await addMember(companyId, 'LEDGER');
    expect((await create({ code: '800', name: 'Oikeus on' }, ledger.cookie)).status).toBe(201);
  });

  it('blocks deleting a cost center used on a journal entry line', async () => {
    const costCenter = await createCostCenter(companyId, '900');
    const bank = await createAccount(companyId, 'Pankkitili');
    const sales = await createAccount(companyId, 'Myynti');
    await fiscalYearService.create(companyId, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
    const entry = await journalEntryService.create(companyId, userId, {
      voucherType: 'MEMOVOUCHER',
      date: parseDateOnly('2025-01-15'),
      description: 'Kustannuspaikan käyttö',
      accountId: bank.id,
      lines: [
        { accountId: bank.id, amount: 100, description: '', type: 'debit', vatRate: 0 },
        {
          accountId: sales.id,
          amount: 100,
          description: '',
          type: 'credit',
          vatRate: 0,
          costCenterId: costCenter.id,
        },
      ],
    });

    const blocked = await request(app)
      .delete(`/api/cost-centers/${costCenter.id}`)
      .set('Cookie', cookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toBe('Cost center is in use and cannot be deleted');

    await journalEntryService.remove(companyId, entry.id);
    const removed = await request(app)
      .delete(`/api/cost-centers/${costCenter.id}`)
      .set('Cookie', cookie);
    expect(removed.status).toBe(204);
  });
});
