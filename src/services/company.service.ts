import { prisma } from '../lib/prisma';

export interface CreateCompanyInput {
  name: string;
  businessId: string;
  billingEmail: string;
  billingAddress: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
}

export const companyService = {
  // Companies the user is a member of — drives the company switcher.
  async listForUser(userId: string) {
    const memberships = await prisma.companyUser.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      role: m.role,
      isAdmin: m.isAdmin,
      subscriptionStatus: m.company.subscriptionStatus,
      subscriptionEndsAt: m.company.subscriptionEndsAt,
    }));
  },

  // Create an additional company (e.g. an accountant adding a client business).
  // The creator becomes its ADMIN; the new company starts PENDING_PAYMENT and
  // pays its own subscription.
  async create(userId: string, input: CreateCompanyInput) {
    return prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: input });
      await tx.companyUser.create({
        data: { userId, companyId: company.id, role: 'ADMIN', isAdmin: true },
      });
      return company;
    });
  },
};
