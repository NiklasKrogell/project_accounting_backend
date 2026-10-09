import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { addMember, createTestContext } from './helpers';

const app = createApp();

let cookie: string;
let companyId: string;

beforeEach(async () => {
  const ctx = await createTestContext('ACCOUNTANT');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getSettings = (as = cookie) => request(app).get('/api/settings/company').set('Cookie', as);
const patchSettings = (body: Record<string, unknown>, as = cookie) =>
  request(app).patch('/api/settings/company').set('Cookie', as).send(body);

describe('company settings', () => {
  it('returns the defaults for a company that has saved nothing', async () => {
    const res = await getSettings();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ vatRegistered: true });
    expect(await prisma.companySettings.count({ where: { companyId } })).toBe(0);
  });

  it('saves a change and returns it from the settings endpoint', async () => {
    const saved = await patchSettings({ vatRegistered: false });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ vatRegistered: false });
    expect((await getSettings()).body.data).toEqual({ vatRegistered: false });

    // A second save updates the same row.
    expect((await patchSettings({ vatRegistered: true })).body.data).toEqual({
      vatRegistered: true,
    });
    expect(await prisma.companySettings.count({ where: { companyId } })).toBe(1);
  });

  it('is shared by the members of the company, but not with other companies', async () => {
    const colleague = await addMember(companyId, 'VIEWER');
    const other = await createTestContext('ADMIN');
    await patchSettings({ vatRegistered: false });

    expect((await getSettings(colleague.cookie)).body.data).toEqual({ vatRegistered: false });
    expect((await getSettings(other.cookie)).body.data).toEqual({ vatRegistered: true });
  });

  it('lets roles below ACCOUNTANT read but not change the settings', async () => {
    for (const role of ['VIEWER', 'LEDGER'] as const) {
      const member = await addMember(companyId, role);
      expect((await getSettings(member.cookie)).status).toBe(200);
      expect((await patchSettings({ vatRegistered: false }, member.cookie)).status).toBe(403);
    }
    expect((await getSettings()).body.data).toEqual({ vatRegistered: true });

    const admin = await addMember(companyId, 'ADMIN');
    expect((await patchSettings({ vatRegistered: false }, admin.cookie)).status).toBe(200);
  });

  it('rejects a non-boolean value and unknown settings with 400', async () => {
    expect((await patchSettings({ vatRegistered: 'no' })).status).toBe(400);
    expect((await patchSettings({ language: 'en' })).status).toBe(400);
    expect((await getSettings()).body.data).toEqual({ vatRegistered: true });
  });

  it('is behind the paywall, unlike the user settings', async () => {
    await prisma.company.update({
      where: { id: companyId },
      data: { subscriptionStatus: 'PENDING_PAYMENT' },
    });
    expect((await getSettings()).status).toBe(402);
    expect((await patchSettings({ vatRegistered: false })).status).toBe(402);
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/settings/company')).status).toBe(401);
    expect(
      (await request(app).patch('/api/settings/company').send({ vatRegistered: false })).status,
    ).toBe(401);
  });
});
