import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { addMember, createTestContext, createUserWithoutCompany } from './helpers';

const app = createApp();

const USERS = '/api/settings/company/users';
const COMPANY_INVITATIONS = '/api/settings/company/invitations';
const INBOX = '/api/invitations';

let cookie: string;
let companyId: string;
let admin: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  // A company administrator with the lowest accounting role: the two are
  // independent, and inviting takes only the former.
  admin = await createTestContext('VIEWER', true);
  cookie = admin.cookie;
  companyId = admin.company.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Inviting is what adding a user does for an email that has an account. The
// name sent along is not used for one.
const invite = (email: string, extra: Record<string, unknown> = {}, as = cookie) =>
  request(app)
    .post(USERS)
    .set('Cookie', as)
    .send({ email, firstName: 'Ei', lastName: 'Käytetä', role: 'LEDGER', ...extra });
const members = (as = cookie) => request(app).get(USERS).set('Cookie', as);
const pending = (as = cookie) => request(app).get(COMPANY_INVITATIONS).set('Cookie', as);
const cancel = (id: string, as = cookie) =>
  request(app).delete(`${COMPANY_INVITATIONS}/${id}`).set('Cookie', as);

const inbox = (as: string) => request(app).get(INBOX).set('Cookie', as);
const accept = (id: string, as: string) => request(app).post(`${INBOX}/${id}/accept`).set('Cookie', as);
const decline = (id: string, as: string) => request(app).post(`${INBOX}/${id}/decline`).set('Cookie', as);
const me = (as: string) => request(app).get('/api/auth/me').set('Cookie', as);

const membershipOf = (userId: string, inCompany = companyId) =>
  prisma.companyUser.findUnique({
    where: { userId_companyId: { userId, companyId: inCompany } },
  });

// Invites a user and returns the invitation's id.
async function invited(email: string, extra: Record<string, unknown> = {}, as = cookie) {
  const res = await invite(email, extra, as);
  expect(res.status).toBe(201);
  return res.body.data.invitation.id as string;
}

describe('inviting a user who has an account', () => {
  it('puts an invitation in their inbox instead of making them a member', async () => {
    const invitee = await createUserWithoutCompany();
    const res = await invite(`  ${invitee.user.email.toUpperCase()} `, { role: 'ACCOUNTANT', isAdmin: true });
    expect(res.status).toBe(201);
    const inviter = `${admin.user.firstName} ${admin.user.lastName}`;
    expect(res.body.data).toEqual({
      member: null,
      temporaryPassword: null,
      invitation: {
        id: expect.any(String),
        userId: invitee.user.id,
        firstName: 'Lone',
        lastName: invitee.user.lastName,
        email: invitee.user.email,
        role: 'ACCOUNTANT',
        isAdmin: true,
        invitedBy: inviter,
        createdAt: expect.any(String),
      },
    });
    const { id } = res.body.data.invitation;

    expect(await membershipOf(invitee.user.id)).toBeNull();
    expect((await members()).body.data).toHaveLength(1);
    expect((await pending()).body.data).toEqual([res.body.data.invitation]);

    const theirs = await inbox(invitee.cookie);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data).toEqual([
      {
        id,
        companyId,
        companyName: admin.company.name,
        businessId: admin.company.businessId,
        role: 'ACCOUNTANT',
        isAdmin: true,
        invitedBy: inviter,
        createdAt: expect.any(String),
      },
    ]);

    // The session carries the inbox, and still no company.
    const session = (await me(invitee.cookie)).body.data;
    expect(session.invitations).toEqual(theirs.body.data);
    expect(session.memberships).toEqual([]);
    expect(session.activeCompanyId).toBeNull();
  });

  it('refuses a second invitation and someone who is already a member', async () => {
    const invitee = await createUserWithoutCompany();
    await invited(invitee.user.email);
    const again = await invite(invitee.user.email, { role: 'ADMIN' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('That user has already been invited to this company');
    expect((await pending()).body.data).toEqual([expect.objectContaining({ role: 'LEDGER' })]);

    const member = await addMember(companyId, 'VIEWER');
    const res = await invite(member.user.email);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('That user is already a member of this company');
    expect((await inbox(member.cookie)).body.data).toEqual([]);
  });

  // The company that created such an account can log in as its user.
  it('refuses an account that is still on its temporary password', async () => {
    const other = await createTestContext('VIEWER', true);
    const email = `new-${randomUUID().slice(0, 8)}@example.com`;
    const created = await invite(email, {}, other.cookie);
    expect(created.body.data.temporaryPassword).toEqual(expect.any(String));
    const userId = created.body.data.member.userId as string;

    const res = await invite(email);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('That account has not been taken into use by its user yet');
    expect(await prisma.companyInvitation.count({ where: { userId } })).toBe(0);
  });

  it('is for company administrators only', async () => {
    const invitee = await createUserWithoutCompany();
    // The highest accounting role is not enough without the admin flag.
    const topRole = await addMember(companyId, 'ADMIN');
    expect((await invite(invitee.user.email, {}, topRole.cookie)).status).toBe(403);
    expect((await inbox(invitee.cookie)).body.data).toEqual([]);
  });
});

describe('answering an invitation', () => {
  it('makes a user without a company a member and takes them into it', async () => {
    const invitee = await createUserWithoutCompany();
    const id = await invited(invitee.user.email, { role: 'ACCOUNTANT' });

    const res = await accept(id, invitee.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ companyId });

    expect(await membershipOf(invitee.user.id)).toMatchObject({ role: 'ACCOUNTANT', isAdmin: false });
    const session = (await me(invitee.cookie)).body.data;
    expect(session.activeCompanyId).toBe(companyId);
    expect(session.memberships).toEqual([
      expect.objectContaining({ companyId, role: 'ACCOUNTANT', isAdmin: false }),
    ]);
    expect(session.invitations).toEqual([]);

    const ping = await request(app).get('/api/ping').set('Cookie', invitee.cookie);
    expect(ping.status).toBe(200);
    expect(ping.body.data).toMatchObject({ companyId, role: 'ACCOUNTANT' });

    // An invitation no more, a member instead.
    expect((await pending()).body.data).toEqual([]);
    expect((await members()).body.data).toContainEqual(
      expect.objectContaining({ userId: invitee.user.id, role: 'ACCOUNTANT' }),
    );
  });

  it('gives the administrator flag the invitation carries', async () => {
    const invitee = await createUserWithoutCompany();
    const id = await invited(invitee.user.email, { role: 'VIEWER', isAdmin: true });
    await accept(id, invitee.cookie);
    expect(await membershipOf(invitee.user.id)).toMatchObject({ role: 'VIEWER', isAdmin: true });
  });

  it('leaves a user who is working in another company where they are', async () => {
    const other = await createTestContext('ADMIN', true);
    const id = await invited(other.user.email);

    expect((await accept(id, other.cookie)).status).toBe(200);
    const session = (await me(other.cookie)).body.data;
    expect(session.activeCompanyId).toBe(other.company.id);
    expect(session.memberships.map((m: { companyId: string }) => m.companyId)).toEqual([
      other.company.id,
      companyId,
    ]);
  });

  it('is gone without a trace when declined, and can be sent again', async () => {
    const invitee = await createUserWithoutCompany();
    const id = await invited(invitee.user.email);

    expect((await decline(id, invitee.cookie)).status).toBe(204);
    expect((await inbox(invitee.cookie)).body.data).toEqual([]);
    expect((await pending()).body.data).toEqual([]);
    expect(await membershipOf(invitee.user.id)).toBeNull();
    expect((await accept(id, invitee.cookie)).status).toBe(404);

    expect((await invite(invitee.user.email)).status).toBe(201);
    expect((await inbox(invitee.cookie)).body.data).toHaveLength(1);
  });

  it('is only for the invited user, and only once', async () => {
    const invitee = await createUserWithoutCompany();
    const stranger = await createUserWithoutCompany();
    const id = await invited(invitee.user.email);

    expect((await accept(id, stranger.cookie)).status).toBe(404);
    expect((await decline(id, stranger.cookie)).status).toBe(404);
    // Not the inviting administrator either.
    expect((await accept(id, cookie)).status).toBe(404);
    expect(await membershipOf(stranger.user.id)).toBeNull();
    expect((await inbox(invitee.cookie)).body.data).toHaveLength(1);

    expect((await accept(id, invitee.cookie)).status).toBe(200);
    expect((await accept(id, invitee.cookie)).status).toBe(404);
    expect((await decline(id, invitee.cookie)).status).toBe(404);
    expect(await membershipOf(invitee.user.id)).not.toBeNull();

    expect((await accept(randomUUID(), invitee.cookie)).status).toBe(404);
    expect((await accept('not-a-uuid', invitee.cookie)).status).toBe(400);
  });

  it('needs a session and a password of their own, but no company', async () => {
    expect((await request(app).get(INBOX)).status).toBe(401);

    const lone = await createUserWithoutCompany();
    expect((await inbox(lone.cookie)).status).toBe(200);

    await prisma.user.update({ where: { id: lone.user.id }, data: { mustChangePassword: true } });
    const refused = await inbox(lone.cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('Password change required');
  });
});

describe("a company's pending invitations", () => {
  it('are shown to every member, and cancelled by a company administrator', async () => {
    const invitee = await createUserWithoutCompany();
    const id = await invited(invitee.user.email);

    const viewer = await addMember(companyId, 'VIEWER');
    const seen = await pending(viewer.cookie);
    expect(seen.status).toBe(200);
    expect(seen.body.data).toEqual([expect.objectContaining({ id, email: invitee.user.email })]);

    // The highest accounting role is not enough without the admin flag.
    const topRole = await addMember(companyId, 'ADMIN');
    expect((await cancel(id, viewer.cookie)).status).toBe(403);
    expect((await cancel(id, topRole.cookie)).status).toBe(403);
    expect((await inbox(invitee.cookie)).body.data).toHaveLength(1);

    expect((await cancel(id)).status).toBe(204);
    expect((await pending()).body.data).toEqual([]);
    expect((await inbox(invitee.cookie)).body.data).toEqual([]);
    expect((await accept(id, invitee.cookie)).status).toBe(404);
    expect((await cancel(id)).status).toBe(404);
  });

  it("never include, or reach, another company's", async () => {
    const other = await createTestContext('VIEWER', true);
    const invitee = await createUserWithoutCompany();
    const id = await invited(invitee.user.email, {}, other.cookie);

    expect((await pending()).body.data).toEqual([]);
    expect((await cancel(id)).status).toBe(404);
    expect((await pending(other.cookie)).body.data).toHaveLength(1);

    // The same user can be invited by both, and answers each separately.
    const ours = await invited(invitee.user.email);
    expect((await inbox(invitee.cookie)).body.data.map((i: { id: string }) => i.id).sort()).toEqual(
      [id, ours].sort(),
    );
    expect((await decline(ours, invitee.cookie)).status).toBe(204);
    expect((await pending(other.cookie)).body.data).toHaveLength(1);
  });

  it('require a session and an active subscription', async () => {
    expect((await request(app).get(COMPANY_INVITATIONS)).status).toBe(401);
    await prisma.company.update({
      where: { id: companyId },
      data: { subscriptionStatus: 'PENDING_PAYMENT' },
    });
    expect((await pending()).status).toBe(402);
  });
});
