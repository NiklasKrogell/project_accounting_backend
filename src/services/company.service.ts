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

// The details of a company its administrators maintain in the company
// settings. The business ID is part of them but can't be changed.
export interface CompanyInfo {
  name: string;
  businessId: string;
  billingEmail: string;
  billingAddress: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
}

export type CompanyInfoPatch = {
  [K in Exclude<keyof CompanyInfo, 'businessId'>]?: CompanyInfo[K] | undefined;
};

const COMPANY_INFO_SELECT = {
  name: true,
  businessId: true,
  billingEmail: true,
  billingAddress: true,
  billingCity: true,
  billingPostalCode: true,
  billingCountry: true,
} as const;

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
      await tx.chartOfAccounts.create({ data: { companyId: company.id } });
      return company;
    });
  },

  async getInfo(companyId: string): Promise<CompanyInfo> {
    return prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: COMPANY_INFO_SELECT,
    });
  },

  // Partial update: only the given fields change.
  async updateInfo(companyId: string, patch: CompanyInfoPatch): Promise<CompanyInfo> {
    const data = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.billingEmail !== undefined && { billingEmail: patch.billingEmail }),
      ...(patch.billingAddress !== undefined && { billingAddress: patch.billingAddress }),
      ...(patch.billingCity !== undefined && { billingCity: patch.billingCity }),
      ...(patch.billingPostalCode !== undefined && { billingPostalCode: patch.billingPostalCode }),
      ...(patch.billingCountry !== undefined && { billingCountry: patch.billingCountry }),
    };
    return prisma.company.update({
      where: { id: companyId },
      data,
      select: COMPANY_INFO_SELECT,
    });
  },
};
