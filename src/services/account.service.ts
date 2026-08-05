import type { AccountMainClass, Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { getChartOfAccountsId } from './chart-of-accounts.service';

export interface AccountInput {
  number: string;
  name: string;
  accountGroupId?: string | null | undefined;
}

export interface ListAccountsFilter {
  accountGroupId?: string | undefined;
  mainClass?: AccountMainClass | undefined;
  search?: string | undefined;
}

export const accountService = {
  async create(companyId: string, input: AccountInput) {
    await assertNumberAvailable(companyId, input.number);
    const accountGroupId = await resolveGroup(companyId, input.accountGroupId);
    const chartOfAccountsId = await getChartOfAccountsId(companyId);
    return prisma.account.create({
      data: { companyId, chartOfAccountsId, number: input.number, name: input.name, accountGroupId },
      include: { accountGroup: true },
    });
  },

  async list(companyId: string, filter: ListAccountsFilter) {
    const where: Prisma.AccountWhereInput = { companyId };
    if (filter.accountGroupId) where.accountGroupId = filter.accountGroupId;
    if (filter.mainClass) where.accountGroup = { mainClass: filter.mainClass };
    if (filter.search) {
      where.OR = [
        { number: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return prisma.account.findMany({
      where,
      orderBy: { number: 'asc' },
      include: { accountGroup: true },
    });
  },

  async getById(companyId: string, id: string) {
    const account = await prisma.account.findFirst({
      where: { id, companyId },
      include: { accountGroup: true },
    });
    if (!account) throw AppError.notFound('Account not found');
    return account;
  },

  async update(companyId: string, id: string, input: AccountInput) {
    const account = await prisma.account.findFirst({ where: { id, companyId } });
    if (!account) throw AppError.notFound('Account not found');
    if (input.number !== account.number) {
      await assertNumberAvailable(companyId, input.number);
    }
    const accountGroupId = await resolveGroup(companyId, input.accountGroupId);
    return prisma.account.update({
      where: { id },
      data: { number: input.number, name: input.name, accountGroupId },
      include: { accountGroup: true },
    });
  },

  // An account that has ever been used (booked directly, referenced by a line,
  // or backing a bank account) must not be deleted, or history would dangle.
  async remove(companyId: string, id: string): Promise<void> {
    const account = await prisma.account.findFirst({
      where: { id, companyId },
      include: {
        _count: { select: { journalEntries: true, lines: true, bankAccounts: true } },
      },
    });
    if (!account) throw AppError.notFound('Account not found');
    const { journalEntries, lines, bankAccounts } = account._count;
    if (journalEntries + lines > 0) {
      throw AppError.conflict('Account is used by journal entries and cannot be deleted');
    }
    if (bankAccounts > 0) {
      throw AppError.conflict('Account is linked to a bank account and cannot be deleted');
    }
    await prisma.account.delete({ where: { id } });
  },
};

async function assertNumberAvailable(companyId: string, number: string): Promise<void> {
  const existing = await prisma.account.findFirst({ where: { companyId, number } });
  if (existing) throw AppError.conflict(`Account number ${number} already exists`);
}

// Ensures a referenced group belongs to the same company; returns the id (or
// null when detaching from any group).
async function resolveGroup(
  companyId: string,
  accountGroupId: string | null | undefined,
): Promise<string | null> {
  if (!accountGroupId) return null;
  const group = await prisma.accountGroup.findFirst({
    where: { id: accountGroupId, companyId },
  });
  if (!group) throw AppError.badRequest('Account group does not exist in this company');
  return accountGroupId;
}
