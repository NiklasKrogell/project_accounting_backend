import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

// A company's suppliers: whom its purchase invoices are from. The bank
// details, the default account and the default VAT rate are only prefills for
// the UI's new invoices and rows; nothing here copies them onto an invoice.

export interface SupplierInput {
  name: string;
  // Normalized and checked by the controller (a Finnish one by its check
  // digit); null for none.
  businessId: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  streetAddress: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  iban: string | null;
  bic: string | null;
  defaultAccountId: string | null;
  defaultVatRate: number | null;
}

export interface ListSuppliersFilter {
  // Part of the name or the business ID, in any case.
  search?: string | undefined;
}

const withDefaultAccount = {
  defaultAccount: { select: { id: true, number: true, name: true } },
} satisfies Prisma.SupplierInclude;

export type SupplierWithDefaultAccount = Prisma.SupplierGetPayload<{
  include: typeof withDefaultAccount;
}>;

export const supplierService = {
  async list(companyId: string, filter: ListSuppliersFilter) {
    const where: Prisma.SupplierWhereInput = { companyId };
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { businessId: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return prisma.supplier.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: withDefaultAccount,
    });
  },

  async getById(companyId: string, id: string) {
    const supplier = await prisma.supplier.findFirst({
      where: { id, companyId },
      include: withDefaultAccount,
    });
    if (!supplier) throw AppError.notFound('Supplier not found');
    return supplier;
  },

  async create(companyId: string, input: SupplierInput) {
    await assertDefaultAccountInCompany(companyId, input.defaultAccountId);
    if (input.businessId) await assertBusinessIdAvailable(companyId, input.businessId);
    return prisma.supplier.create({
      data: { companyId, ...input },
      include: withDefaultAccount,
    });
  },

  // Full replace: a field left out of the body is cleared.
  async update(companyId: string, id: string, input: SupplierInput) {
    const supplier = await prisma.supplier.findFirst({ where: { id, companyId } });
    if (!supplier) throw AppError.notFound('Supplier not found');
    await assertDefaultAccountInCompany(companyId, input.defaultAccountId);
    if (input.businessId && input.businessId !== supplier.businessId) {
      await assertBusinessIdAvailable(companyId, input.businessId);
    }
    return prisma.supplier.update({
      where: { id: supplier.id },
      data: input,
      include: withDefaultAccount,
    });
  },

  // A supplier with invoices stays: they point at it (Restrict).
  async remove(companyId: string, id: string): Promise<void> {
    const supplier = await prisma.supplier.findFirst({
      where: { id, companyId },
      include: { _count: { select: { invoices: true } } },
    });
    if (!supplier) throw AppError.notFound('Supplier not found');
    if (supplier._count.invoices > 0) {
      throw AppError.conflict('Supplier has purchase invoices and cannot be deleted');
    }
    await prisma.supplier.delete({ where: { id: supplier.id } });
  },
};

// The default account must be the company's own; another company's is
// indistinguishable from a nonexistent one.
async function assertDefaultAccountInCompany(
  companyId: string,
  accountId: string | null,
): Promise<void> {
  if (!accountId) return;
  const found = await prisma.account.count({ where: { id: accountId, companyId } });
  if (found === 0) throw AppError.badRequest('Account does not exist in this company');
}

// The unique index decides in the end (a race gets the P2002 409); this gives
// the usual case a message of its own.
async function assertBusinessIdAvailable(companyId: string, businessId: string): Promise<void> {
  const existing = await prisma.supplier.findFirst({ where: { companyId, businessId } });
  if (existing) throw AppError.conflict('A supplier with that business ID already exists');
}
