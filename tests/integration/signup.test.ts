import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestContext, createUserWithoutCompany } from './helpers';

// The signup endpoint is rate limited per IP (5 an hour), and nothing resets
// that inside a test file: keep the number of calls to it under that. The
// company tests therefore start from a user made directly in the database.

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

const suffix = () => randomUUID().slice(0, 8);
const signupBody = (email = `signup-${suffix()}@example.com`) => ({
  email,
  password: 'oma-salasana-123',
  firstName: 'Uusi',
  lastName: 'Käyttäjä',
});
const companyBody = (businessId = `biz-${suffix()}`) => ({
  name: 'Uusi Yritys Oy',
  businessId,
  billingEmail: 'laskut@example.com',
  billingAddress: 'Katu 1 A',
  billingCity: 'Helsinki',
  billingPostalCode: '00100',
  billingCountry: 'Suomi',
});

const signup = (body: Record<string, unknown>) => request(app).post('/api/auth/signup').send(body);
const get = (path: string, as: string) => request(app).get(path).set('Cookie', as);
const createCompany = (body: Record<string, unknown>, as: string) =>
  request(app).post('/api/companies').set('Cookie', as).send(body);

describe('signing up', () => {
  it('creates a user who belongs to no company', async () => {
    const companies = await prisma.company.count();
    const body = signupBody(`Signup-${suffix()}@Example.com`);
    const res = await signup(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      user: expect.objectContaining({
        email: body.email.toLowerCase(),
        firstName: 'Uusi',
        lastName: 'Käyttäjä',
        mustChangePassword: false,
      }),
    });
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(await prisma.company.count()).toBe(companies);

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie[0]!.split(';')[0]!;
    const me = await get('/api/auth/me', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.memberships).toEqual([]);
    expect(me.body.data.activeCompanyId).toBeNull();

    // Nothing of the application answers without a company.
    const ping = await get('/api/ping', cookie);
    expect(ping.status).toBe(403);
    expect(ping.body.error.message).toBe('No active company selected');
  });

  it('does not take company details any more', async () => {
    const companies = await prisma.company.count();
    const res = await signup({ ...signupBody(), ...companyBody(), companyName: 'Vanha Malli Oy' });
    expect(res.status).toBe(201);
    expect(res.body.data.company).toBeUndefined();
    expect(await prisma.company.count()).toBe(companies);
  });

  it('refuses an email that already has an account, and invalid input', async () => {
    const { user } = await createUserWithoutCompany();
    const taken = await signup(signupBody(user.email));
    expect(taken.status).toBe(409);

    const { firstName: _firstName, ...withoutName } = signupBody();
    expect((await signup(withoutName)).status).toBe(400);
    expect(await prisma.user.count({ where: { email: withoutName.email } })).toBe(0);
  });
});

describe('registering a company', () => {
  it("makes it the user's active company, unpaid", async () => {
    const { user, cookie } = await createUserWithoutCompany();
    const body = companyBody();
    const res = await createCompany({ ...body, name: '  Uusi Yritys Oy ' }, cookie);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      name: 'Uusi Yritys Oy',
      subscriptionStatus: 'PENDING_PAYMENT',
    });
    const companyId: string = res.body.data.id;

    const me = await get('/api/auth/me', cookie);
    expect(me.body.data.activeCompanyId).toBe(companyId);
    expect(me.body.data.memberships).toEqual([
      expect.objectContaining({
        companyId,
        companyName: 'Uusi Yritys Oy',
        role: 'ADMIN',
        isAdmin: true,
        subscriptionStatus: 'PENDING_PAYMENT',
      }),
    ]);
    expect(await prisma.companyUser.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.chartOfAccounts.count({ where: { companyId } })).toBe(1);

    // Selected, but behind the paywall until its subscription is active.
    expect((await get('/api/ping', cookie)).status).toBe(402);
  });

  it('moves a user who already works in a company over to the new one', async () => {
    const ctx = await createTestContext('VIEWER');
    const res = await createCompany(companyBody(), ctx.cookie);
    expect(res.status).toBe(201);

    const me = await get('/api/auth/me', ctx.cookie);
    expect(me.body.data.activeCompanyId).toBe(res.body.data.id);
    expect(me.body.data.memberships.map((m: { companyId: string }) => m.companyId)).toEqual([
      ctx.company.id,
      res.body.data.id,
    ]);
  });

  it('refuses a business ID that is taken', async () => {
    const existing = await createTestContext();
    const { user, cookie } = await createUserWithoutCompany();
    const res = await createCompany(companyBody(existing.company.businessId), cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('A company with that business ID already exists');

    expect(await prisma.companyUser.count({ where: { userId: user.id } })).toBe(0);
    expect((await get('/api/auth/me', cookie)).body.data.activeCompanyId).toBeNull();
  });

  it('rejects invalid details with 400 and requires a session', async () => {
    const { user, cookie } = await createUserWithoutCompany();
    const body = companyBody();
    expect((await createCompany({ ...body, name: '   ' }, cookie)).status).toBe(400);
    expect((await createCompany({ ...body, name: 'x'.repeat(201) }, cookie)).status).toBe(400);
    expect((await createCompany({ ...body, billingEmail: 'not-an-email' }, cookie)).status).toBe(400);
    const { billingCity: _billingCity, ...withoutCity } = body;
    expect((await createCompany(withoutCity, cookie)).status).toBe(400);
    expect(await prisma.companyUser.count({ where: { userId: user.id } })).toBe(0);

    expect((await request(app).post('/api/companies').send(body)).status).toBe(401);
    expect(await prisma.company.count({ where: { businessId: body.businessId } })).toBe(0);
  });
});
