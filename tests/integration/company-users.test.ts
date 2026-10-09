import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { addMember, createTestContext } from './helpers';

const app = createApp();

const USERS = '/api/settings/company/users';
const TEMPORARY_PASSWORD = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;

let cookie: string;
let companyId: string;
let adminId: string;

beforeEach(async () => {
  // A company administrator with the lowest accounting role: the two are
  // independent, and adding and removing people takes only the former.
  const ctx = await createTestContext('VIEWER', true);
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  adminId = ctx.user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const list = (as = cookie) => request(app).get(USERS).set('Cookie', as);
const create = (body: Record<string, unknown>, as = cookie) =>
  request(app).post(USERS).set('Cookie', as).send(body);
const patch = (userId: string, body: Record<string, unknown>, as = cookie) =>
  request(app).patch(`${USERS}/${userId}`).set('Cookie', as).send(body);
const remove = (userId: string, as = cookie) =>
  request(app).delete(`${USERS}/${userId}`).set('Cookie', as);
const resetTemporaryPassword = (userId: string, as = cookie) =>
  request(app).post(`${USERS}/${userId}/temporary-password`).set('Cookie', as);

const newEmail = () => `new-${randomUUID().slice(0, 8)}@example.com`;
const person = (overrides: Record<string, unknown> = {}) => ({
  email: newEmail(),
  firstName: 'Uusi',
  lastName: 'Käyttäjä',
  role: 'LEDGER',
  ...overrides,
});

const membershipOf = (userId: string, inCompany = companyId) =>
  prisma.companyUser.findUnique({
    where: { userId_companyId: { userId, companyId: inCompany } },
  });

describe('company users: listing', () => {
  it("lists the active company's members to every member", async () => {
    const ledger = await addMember(companyId, 'LEDGER');
    await createTestContext('ADMIN', true); // another company's member

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data).toContainEqual({
      userId: ledger.user.id,
      firstName: 'Member',
      lastName: ledger.user.lastName,
      email: ledger.user.email,
      role: 'LEDGER',
      isAdmin: false,
      joinedAt: expect.any(String),
      pendingFirstLogin: false,
    });
    expect(res.body.data).toContainEqual(
      expect.objectContaining({ userId: adminId, role: 'VIEWER', isAdmin: true }),
    );

    const viewer = await addMember(companyId, 'VIEWER');
    expect((await list(viewer.cookie)).status).toBe(200);
  });

  it('requires a session and an active subscription', async () => {
    expect((await request(app).get(USERS)).status).toBe(401);
    await prisma.company.update({
      where: { id: companyId },
      data: { subscriptionStatus: 'PENDING_PAYMENT' },
    });
    expect((await list()).status).toBe(402);
    expect((await create(person())).status).toBe(402);
  });
});

describe('company users: creating', () => {
  it('creates an account with a temporary password that has to be changed', async () => {
    const email = newEmail();
    const res = await create(person({ email: `  ${email.toUpperCase()} ` }));
    expect(res.status).toBe(201);
    expect(res.body.data.member).toMatchObject({
      email,
      firstName: 'Uusi',
      lastName: 'Käyttäjä',
      role: 'LEDGER',
      isAdmin: false,
      pendingFirstLogin: true,
    });
    const temporaryPassword = res.body.data.temporaryPassword as string;
    expect(temporaryPassword).toMatch(TEMPORARY_PASSWORD);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.mustChangePassword).toBe(true);
    expect(await argon2.verify(user.password_hash, temporaryPassword)).toBe(true);
    expect(await membershipOf(user.id)).toMatchObject({ role: 'LEDGER', isAdmin: false });
    expect((await list()).body.data).toContainEqual(res.body.data.member);
  });

  it('can make the new user a company administrator', async () => {
    const res = await create(person({ role: 'ACCOUNTANT', isAdmin: true }));
    expect(res.status).toBe(201);
    expect(res.body.data.member).toMatchObject({ role: 'ACCOUNTANT', isAdmin: true });
  });

  // What becomes of the invitation is in company-invitations.test.ts.
  it('invites someone who already has an account instead of adding them', async () => {
    const other = await createTestContext('ADMIN', true);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });

    const res = await create(
      person({ email: other.user.email, firstName: 'Toinen', lastName: 'Nimi', role: 'ACCOUNTANT' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.member).toBeNull();
    expect(res.body.data.temporaryPassword).toBeNull();
    expect(res.body.data.invitation).toMatchObject({
      userId: other.user.id,
      firstName: before.firstName,
      lastName: before.lastName,
      role: 'ACCOUNTANT',
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.mustChangePassword).toBe(false);

    // Not a member before accepting: they see and work in their own company only.
    expect(await membershipOf(other.user.id)).toBeNull();
    expect((await list()).body.data).toHaveLength(1);
    const me = await request(app).get('/api/auth/me').set('Cookie', other.cookie);
    expect(me.body.data.memberships.map((m: { companyId: string }) => m.companyId)).toEqual([
      other.company.id,
    ]);
    expect(me.body.data.activeCompanyId).toBe(other.company.id);
  });

  it('refuses someone who is already a member', async () => {
    const member = await addMember(companyId, 'VIEWER');
    const res = await create(person({ email: member.user.email }));
    expect(res.status).toBe(409);
    expect(await membershipOf(member.user.id)).toMatchObject({ role: 'VIEWER' });
  });

  it('is for company administrators only', async () => {
    // The highest accounting role is not enough without the admin flag.
    const topRole = await addMember(companyId, 'ADMIN');
    const input = person();
    expect((await create(input, topRole.cookie)).status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: input.email } })).toBeNull();
  });

  it('rejects invalid input with 400', async () => {
    expect((await create(person({ email: 'not-an-email' }))).status).toBe(400);
    expect((await create(person({ firstName: '  ' }))).status).toBe(400);
    expect((await create(person({ lastName: undefined }))).status).toBe(400);
    expect((await create(person({ role: 'OWNER' }))).status).toBe(400);
    expect((await create(person({ role: undefined }))).status).toBe(400);
    expect((await create(person({ isAdmin: 'yes' }))).status).toBe(400);
    expect((await list()).body.data).toHaveLength(1);
  });
});

describe('company users: changing roles', () => {
  it('lets a company administrator set any role and the administrator flag on others', async () => {
    const member = await addMember(companyId, 'VIEWER');

    const promoted = await patch(member.user.id, { role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data).toMatchObject({ userId: member.user.id, role: 'ADMIN', isAdmin: false });

    const flagged = await patch(member.user.id, { isAdmin: true });
    expect(flagged.status).toBe(200);
    expect(flagged.body.data).toMatchObject({ role: 'ADMIN', isAdmin: true });

    // Another administrator is within reach too.
    const both = await patch(member.user.id, { role: 'LEDGER', isAdmin: false });
    expect(both.body.data).toMatchObject({ role: 'LEDGER', isAdmin: false });
    expect(await membershipOf(member.user.id)).toMatchObject({ role: 'LEDGER', isAdmin: false });
  });

  it('lets an accountant move the members below them between the roles below their own', async () => {
    const accountant = await addMember(companyId, 'ACCOUNTANT');
    const viewer = await addMember(companyId, 'VIEWER');
    const as = accountant.cookie;

    expect((await patch(viewer.user.id, { role: 'LEDGER' }, as)).status).toBe(200);
    expect((await patch(viewer.user.id, { role: 'VIEWER' }, as)).status).toBe(200);

    // Not up to their own level or above it.
    expect((await patch(viewer.user.id, { role: 'ACCOUNTANT' }, as)).status).toBe(403);
    expect((await patch(viewer.user.id, { role: 'ADMIN' }, as)).status).toBe(403);
    // Not the administrator flag.
    expect((await patch(viewer.user.id, { isAdmin: true }, as)).status).toBe(403);
    expect((await patch(viewer.user.id, { role: 'LEDGER', isAdmin: true }, as)).status).toBe(403);
    expect(await membershipOf(viewer.user.id)).toMatchObject({ role: 'VIEWER', isAdmin: false });

    // Not their equals, their betters or a company administrator.
    const peer = await addMember(companyId, 'ACCOUNTANT');
    const topRole = await addMember(companyId, 'ADMIN');
    expect((await patch(peer.user.id, { role: 'LEDGER' }, as)).status).toBe(403);
    expect((await patch(topRole.user.id, { role: 'LEDGER' }, as)).status).toBe(403);
    expect((await patch(adminId, { role: 'LEDGER' }, as)).status).toBe(403);
    expect(await membershipOf(adminId)).toMatchObject({ role: 'VIEWER', isAdmin: true });
  });

  it('gives the ADMIN role without the administrator flag one level more', async () => {
    const topRole = await addMember(companyId, 'ADMIN');
    const accountant = await addMember(companyId, 'ACCOUNTANT');
    const as = topRole.cookie;

    expect((await patch(accountant.user.id, { role: 'LEDGER' }, as)).status).toBe(200);
    expect((await patch(accountant.user.id, { role: 'ACCOUNTANT' }, as)).status).toBe(200);
    expect((await patch(accountant.user.id, { role: 'ADMIN' }, as)).status).toBe(403);
    expect((await patch(accountant.user.id, { isAdmin: true }, as)).status).toBe(403);
  });

  it('lets nobody below accountant change a role', async () => {
    const ledger = await addMember(companyId, 'LEDGER');
    const viewer = await addMember(companyId, 'VIEWER');
    expect((await patch(viewer.user.id, { role: 'VIEWER' }, ledger.cookie)).status).toBe(403);
    expect((await patch(ledger.user.id, { role: 'VIEWER' }, viewer.cookie)).status).toBe(403);
    // Not even with nothing to change.
    expect((await patch(viewer.user.id, {}, ledger.cookie)).status).toBe(403);
  });

  it('lets nobody change their own role or administrator flag', async () => {
    expect((await patch(adminId, { role: 'ADMIN' })).status).toBe(403);
    expect((await patch(adminId, { isAdmin: false })).status).toBe(403);
    expect(await membershipOf(adminId)).toMatchObject({ role: 'VIEWER', isAdmin: true });

    const accountant = await addMember(companyId, 'ACCOUNTANT');
    expect((await patch(accountant.user.id, { role: 'LEDGER' }, accountant.cookie)).status).toBe(403);
  });

  it('rejects unknown keys and values with 400', async () => {
    const member = await addMember(companyId, 'VIEWER');
    expect((await patch(member.user.id, { role: 'OWNER' })).status).toBe(400);
    expect((await patch(member.user.id, { isAdmin: 'yes' })).status).toBe(400);
    expect((await patch(member.user.id, { roel: 'LEDGER' })).status).toBe(400);
    expect((await patch(member.user.id, { role: 'LEDGER', email: 'x@example.com' })).status).toBe(400);
    expect((await patch('not-a-uuid', { role: 'LEDGER' })).status).toBe(400);
    expect(await membershipOf(member.user.id)).toMatchObject({ role: 'VIEWER' });
  });

  it("answers 404 for another company's user", async () => {
    const other = await createTestContext('VIEWER');
    expect((await patch(other.user.id, { role: 'ADMIN' })).status).toBe(404);
    expect(await membershipOf(other.user.id, other.company.id)).toMatchObject({ role: 'VIEWER' });
  });
});

describe('company users: removing access', () => {
  it('ends the access at once and keeps the account', async () => {
    const member = await addMember(companyId, 'ACCOUNTANT');
    expect((await list(member.cookie)).status).toBe(200);

    expect((await remove(member.user.id)).status).toBe(204);
    expect(await membershipOf(member.user.id)).toBeNull();
    expect((await list()).body.data).toHaveLength(1);

    const refused = await list(member.cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('No active company selected');

    // Still an account, just one without a company.
    const me = await request(app).get('/api/auth/me').set('Cookie', member.cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.memberships).toEqual([]);
    expect(me.body.data.activeCompanyId).toBeNull();
  });

  it('reports no active company on the very first request after the removal', async () => {
    const member = await addMember(companyId, 'VIEWER');
    // Not through the endpoint, which clears the session's company itself.
    await prisma.companyUser.delete({
      where: { userId_companyId: { userId: member.user.id, companyId } },
    });
    const me = await request(app).get('/api/auth/me').set('Cookie', member.cookie);
    expect(me.body.data.activeCompanyId).toBeNull();
  });

  it('deletes an account that was never taken into use, freeing its email', async () => {
    const input = person();
    const created = await create(input);
    const userId = created.body.data.member.userId as string;

    expect((await remove(userId)).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();

    const again = await create({ ...input, firstName: 'Korjattu' });
    expect(again.status).toBe(201);
    expect(again.body.data.member.firstName).toBe('Korjattu');
    expect(again.body.data.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
  });

  // The API doesn't let a second company in while the account is unused (it
  // refuses to invite it), so the membership is made directly: the check is
  // kept for one that got there some other way.
  it('keeps an unused account that belongs to another company too', async () => {
    const input = person();
    const userId = (await create(input)).body.data.member.userId as string;
    const other = await createTestContext('VIEWER', true);
    await prisma.companyUser.create({ data: { userId, companyId: other.company.id } });

    expect((await remove(userId)).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    expect(await membershipOf(userId, other.company.id)).not.toBeNull();
  });

  it('is for company administrators, and never oneself', async () => {
    const topRole = await addMember(companyId, 'ADMIN');
    const viewer = await addMember(companyId, 'VIEWER');
    expect((await remove(viewer.user.id, topRole.cookie)).status).toBe(403);
    expect(await membershipOf(viewer.user.id)).not.toBeNull();

    expect((await remove(adminId)).status).toBe(403);
    expect(await membershipOf(adminId)).not.toBeNull();
  });

  it("answers 404 for another company's user", async () => {
    const other = await createTestContext('VIEWER');
    expect((await remove(other.user.id)).status).toBe(404);
    expect(await membershipOf(other.user.id, other.company.id)).not.toBeNull();
  });
});

describe('company users: a new temporary password', () => {
  it('replaces the one of a user who has not taken the account into use', async () => {
    const created = await create(person());
    const userId = created.body.data.member.userId as string;
    const first = created.body.data.temporaryPassword as string;

    const res = await resetTemporaryPassword(userId);
    expect(res.status).toBe(200);
    const second = res.body.data.temporaryPassword as string;
    expect(second).toMatch(TEMPORARY_PASSWORD);
    expect(second).not.toBe(first);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mustChangePassword).toBe(true);
    expect(await argon2.verify(user.password_hash, second)).toBe(true);
    expect(await argon2.verify(user.password_hash, first)).toBe(false);
  });

  it('refuses a user who has a password of their own', async () => {
    const member = await addMember(companyId, 'VIEWER');
    const res = await resetTemporaryPassword(member.user.id);
    expect(res.status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } });
    expect(user.password_hash).toBe('not-a-real-hash');
  });

  it('refuses a user who also belongs to another company', async () => {
    const input = person();
    const created = await create(input);
    const userId = created.body.data.member.userId as string;
    const other = await createTestContext('VIEWER', true);
    // Directly, as above: the API refuses to invite an unused account.
    await prisma.companyUser.create({ data: { userId, companyId: other.company.id } });

    expect((await resetTemporaryPassword(userId)).status).toBe(409);
    expect((await resetTemporaryPassword(userId, other.cookie)).status).toBe(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await argon2.verify(user.password_hash, created.body.data.temporaryPassword)).toBe(true);
  });

  it("is for company administrators, and answers 404 for another company's user", async () => {
    const userId = (await create(person())).body.data.member.userId as string;
    const topRole = await addMember(companyId, 'ADMIN');
    expect((await resetTemporaryPassword(userId, topRole.cookie)).status).toBe(403);

    const other = await createTestContext('VIEWER', true);
    expect((await resetTemporaryPassword(userId, other.cookie)).status).toBe(404);
  });
});
