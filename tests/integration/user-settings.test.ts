import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { addMember, createTestContext } from './helpers';

const app = createApp();

let cookie: string;
let companyId: string;
let userId: string;

beforeEach(async () => {
  const ctx = await createTestContext('VIEWER');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  userId = ctx.user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getSettings = (as = cookie) => request(app).get('/api/settings/user').set('Cookie', as);
const patchSettings = (body: Record<string, unknown>, as = cookie) =>
  request(app).patch('/api/settings/user').set('Cookie', as).send(body);

// A second company the same user belongs to.
async function addCompanyFor(memberId: string) {
  const suffix = randomUUID().slice(0, 8);
  const company = await prisma.company.create({
    data: {
      name: `Other Co ${suffix}`,
      subscriptionStatus: 'ACTIVE',
      businessId: `other-${suffix}`,
      billingEmail: `billing-${suffix}@example.com`,
      billingAddress: 'Test Address 2',
      billingCity: 'Testville',
      billingPostalCode: '00000',
      billingCountry: 'Finland',
    },
  });
  await prisma.companyUser.create({ data: { userId: memberId, companyId: company.id } });
  return company;
}

describe('user settings', () => {
  it('returns the defaults for a user who has saved nothing', async () => {
    const res = await getSettings();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ language: 'fi' });
    expect(await prisma.userSettings.count({ where: { userId } })).toBe(0);
  });

  it('saves a change and returns it from the settings endpoint and /me', async () => {
    const saved = await patchSettings({ language: 'en' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ language: 'en' });

    expect((await getSettings()).body.data).toEqual({ language: 'en' });
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.data.settings).toEqual({ language: 'en' });

    // A second save updates the same row.
    expect((await patchSettings({ language: 'fi' })).body.data).toEqual({ language: 'fi' });
    expect(await prisma.userSettings.count({ where: { userId } })).toBe(1);
  });

  it('follows the user from one company to another', async () => {
    await patchSettings({ language: 'en' });
    const other = await addCompanyFor(userId);

    const switched = await request(app)
      .post('/api/auth/switch-company')
      .set('Cookie', cookie)
      .send({ companyId: other.id });
    expect(switched.status).toBe(200);
    expect(switched.body.data.activeCompanyId).toBe(other.id);

    expect((await getSettings()).body.data).toEqual({ language: 'en' });
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.data.activeCompanyId).toBe(other.id);
    expect(me.body.data.settings).toEqual({ language: 'en' });
  });

  it('is not shared with other users of the same company', async () => {
    const colleague = await addMember(companyId, 'ADMIN');
    await patchSettings({ language: 'en' });

    expect((await getSettings(colleague.cookie)).body.data).toEqual({ language: 'fi' });
  });

  it('works while the active company has no active subscription', async () => {
    await prisma.company.update({
      where: { id: companyId },
      data: { subscriptionStatus: 'PENDING_PAYMENT' },
    });
    const gated = await request(app).get('/api/ping').set('Cookie', cookie);
    expect(gated.status).toBe(402);

    expect((await patchSettings({ language: 'en' })).status).toBe(200);
    expect((await getSettings()).body.data).toEqual({ language: 'en' });
  });

  it('rejects an unsupported language and unknown settings with 400', async () => {
    expect((await patchSettings({ language: 'sv' })).status).toBe(400);
    expect((await patchSettings({ theme: 'dark' })).status).toBe(400);
    expect((await getSettings()).body.data).toEqual({ language: 'fi' });
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/settings/user')).status).toBe(401);
    expect((await request(app).patch('/api/settings/user').send({ language: 'en' })).status).toBe(401);
  });
});
