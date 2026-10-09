import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { authService } from '../../src/services/auth.service';
import { createTestContext } from './helpers';

// The login and change-password endpoints are rate limited per IP (10 per 15
// minutes each), and nothing resets that inside a test file: keep the number
// of calls to each well under it.

const app = createApp();

const NEW_PASSWORD = 'oma-salasana-123';

let adminCookie: string;
let companyId: string;
let email: string;
let userId: string;
let temporaryPassword: string;

// A user the company's administrator has just created.
beforeEach(async () => {
  const ctx = await createTestContext('VIEWER', true);
  adminCookie = ctx.cookie;
  companyId = ctx.company.id;
  email = `new-${randomUUID().slice(0, 8)}@example.com`;
  const created = await request(app)
    .post('/api/settings/company/users')
    .set('Cookie', adminCookie)
    .send({ email, firstName: 'Uusi', lastName: 'Käyttäjä', role: 'LEDGER' });
  userId = created.body.data.member.userId;
  temporaryPassword = created.body.data.temporaryPassword;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function login(password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  return { status: res.status, cookie: setCookie?.[0]?.split(';')[0] ?? '' };
}
const get = (path: string, as: string) => request(app).get(path).set('Cookie', as);
const changePassword = (body: Record<string, unknown>, as: string) =>
  request(app).post('/api/auth/change-password').set('Cookie', as).send(body);
const mustChange = async () =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mustChangePassword;

describe('an account created with a temporary password', () => {
  it('logs in with it, but is answered only by the auth routes', async () => {
    const { status, cookie } = await login(temporaryPassword);
    expect(status).toBe(200);

    const me = await get('/api/auth/me', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ email, mustChangePassword: true });
    expect(me.body.data.user.password_hash).toBeUndefined();
    expect(me.body.data.activeCompanyId).toBe(companyId);

    for (const path of ['/api/ping', '/api/settings/company/users', '/api/companies', '/api/settings/user']) {
      const res = await get(path, cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('Password change required');
    }
  });

  it('gets in once the user has set a password of their own', async () => {
    const { cookie } = await login(temporaryPassword);

    expect((await changePassword({ currentPassword: 'wrong', newPassword: NEW_PASSWORD }, cookie)).status).toBe(400);
    expect((await changePassword({ currentPassword: temporaryPassword, newPassword: 'short' }, cookie)).status).toBe(400);
    expect(
      (await changePassword({ currentPassword: temporaryPassword, newPassword: temporaryPassword }, cookie)).status,
    ).toBe(400);
    expect((await changePassword({ newPassword: NEW_PASSWORD }, cookie)).status).toBe(400);
    expect(await mustChange()).toBe(true);

    const changed = await changePassword({ currentPassword: temporaryPassword, newPassword: NEW_PASSWORD }, cookie);
    expect(changed.status).toBe(200);
    expect(changed.body.data).toEqual({ changed: true });
    expect(await mustChange()).toBe(false);

    // The session used for the change carries on.
    expect((await get('/api/ping', cookie)).status).toBe(200);
    expect((await get('/api/auth/me', cookie)).body.data.user.mustChangePassword).toBe(false);
    const members = await get('/api/settings/company/users', adminCookie);
    expect(members.body.data).toContainEqual(
      expect.objectContaining({ userId, pendingFirstLogin: false }),
    );

    expect((await login(temporaryPassword)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('is logged out everywhere else by the change', async () => {
    const first = await login(temporaryPassword);
    const second = await login(temporaryPassword);

    await changePassword({ currentPassword: temporaryPassword, newPassword: NEW_PASSWORD }, first.cookie);
    expect((await get('/api/auth/me', first.cookie)).status).toBe(200);
    expect((await get('/api/auth/me', second.cookie)).status).toBe(401);
  });

  it('is logged out when the administrator issues a new temporary password', async () => {
    const { cookie } = await login(temporaryPassword);
    const res = await request(app)
      .post(`/api/settings/company/users/${userId}/temporary-password`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect((await get('/api/auth/me', cookie)).status).toBe(401);
    expect((await login(res.body.data.temporaryPassword)).status).toBe(200);
  });

  it('is done with the temporary password after a password reset too', async () => {
    const token = await authService.issueToken(userId, 'PASSWORD_RESET');
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(await mustChange()).toBe(false);
  });
});

describe('changing the password', () => {
  it('requires a session', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: temporaryPassword, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(await mustChange()).toBe(true);
  });
});
