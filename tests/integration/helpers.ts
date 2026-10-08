import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Role } from '../../src/generated/prisma/client';
import { prisma } from '../../src/lib/prisma';

// Creates an isolated company + user + membership + session directly in the
// test database. Returns the session cookie the HTTP tests authenticate with.
export async function createTestContext(role: Role = 'ADMIN') {
  const suffix = randomUUID().slice(0, 8);
  const company = await prisma.company.create({
    data: {
      name: `Test Co ${suffix}`,
      subscriptionStatus: 'ACTIVE',
      businessId: `test-${suffix}`,
      billingEmail: `billing-${suffix}@example.com`,
      billingAddress: 'Test Address 1',
      billingCity: 'Testville',
      billingPostalCode: '00000',
      billingCountry: 'Finland',
    },
  });
  await prisma.chartOfAccounts.create({ data: { companyId: company.id } });
  const user = await prisma.user.create({
    data: {
      firstName: 'Test',
      lastName: `User ${suffix}`,
      email: `test-${suffix}@example.com`,
      password_hash: 'not-a-real-hash',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.companyUser.create({
    data: { userId: user.id, companyId: company.id, role },
  });
  const token = randomBytes(24).toString('base64url');
  await prisma.session.create({
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: user.id,
      activeCompanyId: company.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { company, user, cookie: `session=${token}` };
}

// Adds an extra member with the given role to an existing company, with their
// own session cookie.
export async function addMember(companyId: string, role: Role) {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      firstName: 'Member',
      lastName: `User ${suffix}`,
      email: `member-${suffix}@example.com`,
      password_hash: 'not-a-real-hash',
    },
  });
  await prisma.companyUser.create({ data: { userId: user.id, companyId, role } });
  const token = randomBytes(24).toString('base64url');
  await prisma.session.create({
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: user.id,
      activeCompanyId: companyId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { user, cookie: `session=${token}` };
}

export async function createCostCenter(companyId: string, code: string, name = `Kustannuspaikka ${code}`) {
  return prisma.costCenter.create({ data: { companyId, code, name } });
}

// Account numbers are unique per company; randomize to avoid collisions.
export async function createAccount(companyId: string, name: string) {
  const chart = await prisma.chartOfAccounts.findUniqueOrThrow({ where: { companyId } });
  return prisma.account.create({
    data: {
      number: String(Math.floor(Math.random() * 900_000_000) + 100_000_000),
      name,
      companyId,
      chartOfAccountsId: chart.id,
    },
  });
}
