import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { addMember, createTestContext } from './helpers';

const app = createApp();

let cookie: string;
let companyId: string;

beforeEach(async () => {
  // A company administrator with the lowest accounting role: the two are
  // independent, and only the former matters here.
  const ctx = await createTestContext('VIEWER', true);
  cookie = ctx.cookie;
  companyId = ctx.company.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getInfo = (as = cookie) => request(app).get('/api/settings/company/info').set('Cookie', as);
const patchInfo = (body: Record<string, unknown>, as = cookie) =>
  request(app).patch('/api/settings/company/info').set('Cookie', as).send(body);

describe('company info', () => {
  it("returns the active company's details", async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const res = await getInfo();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      name: company.name,
      businessId: company.businessId,
      billingEmail: company.billingEmail,
      billingAddress: 'Test Address 1',
      billingCity: 'Testville',
      billingPostalCode: '00000',
      billingCountry: 'Finland',
    });
  });

  it('changes only the fields sent, trimmed', async () => {
    const before = (await getInfo()).body.data;
    const renamed = await patchInfo({ name: '  Uusi Nimi Oy ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toEqual({ ...before, name: 'Uusi Nimi Oy' });

    const billing = {
      billingEmail: 'laskut@example.com',
      billingAddress: 'Katu 1 A',
      billingCity: 'Helsinki',
      billingPostalCode: '00100',
      billingCountry: 'Suomi',
    };
    const updated = await patchInfo(billing);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({ ...before, name: 'Uusi Nimi Oy', ...billing });
    expect((await getInfo()).body.data).toEqual(updated.body.data);
  });

  it('shows the new name in the list of the user\'s companies', async () => {
    await patchInfo({ name: 'Vaihdettu Oy' });
    const res = await request(app).get('/api/companies').set('Cookie', cookie);
    expect(res.body.data.map((c: { companyName: string }) => c.companyName)).toEqual(['Vaihdettu Oy']);
  });

  it('lets every member read, but only company administrators change', async () => {
    // The highest accounting role is not enough without the admin flag.
    for (const role of ['VIEWER', 'ADMIN'] as const) {
      const member = await addMember(companyId, role);
      expect((await getInfo(member.cookie)).status).toBe(200);
      expect((await patchInfo({ name: 'Kaapattu' }, member.cookie)).status).toBe(403);
    }
    const admin = await addMember(companyId, 'VIEWER', true);
    expect((await patchInfo({ name: 'Sallittu' }, admin.cookie)).status).toBe(200);
    expect((await getInfo()).body.data.name).toBe('Sallittu');
  });

  it('rejects invalid values, unknown keys and a change of business ID with 400', async () => {
    const before = (await getInfo()).body.data;
    expect((await patchInfo({ name: '   ' })).status).toBe(400);
    expect((await patchInfo({ billingEmail: 'not-an-email' })).status).toBe(400);
    expect((await patchInfo({ billingCity: '' })).status).toBe(400);
    expect((await patchInfo({ name: 'x'.repeat(201) })).status).toBe(400);
    expect((await patchInfo({ nmae: 'Typo' })).status).toBe(400);
    expect((await patchInfo({ businessId: '1234567-8' })).status).toBe(400);
    expect((await patchInfo({ name: 'Ok', subscriptionStatus: 'ACTIVE' })).status).toBe(400);
    expect((await getInfo()).body.data).toEqual(before);
  });

  it("never touches another company's details", async () => {
    const other = await createTestContext('ADMIN', true);
    const before = (await getInfo(other.cookie)).body.data;
    await patchInfo({ name: 'Vain tämä', billingCity: 'Tampere' });
    expect((await getInfo(other.cookie)).body.data).toEqual(before);
  });
});
