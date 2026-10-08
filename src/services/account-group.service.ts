import type { AccountMainClass, IncomeStatementSubItem } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { subItemBelongsTo } from '../lib/incomeStatementScheme';
import { getChartOfAccountsId } from './chart-of-accounts.service';

const accountsByNumber = { accounts: { orderBy: { number: 'asc' as const } } };

export interface AccountGroupInput {
  name: string;
  mainClass: AccountMainClass;
  incomeStatementSubItem: IncomeStatementSubItem | null;
}

export const accountGroupService = {
  async create(companyId: string, input: AccountGroupInput) {
    assertSubItemMatchesClass(input);
    await assertNameAvailable(companyId, input.name);
    const chartOfAccountsId = await getChartOfAccountsId(companyId);
    return prisma.accountGroup.create({
      data: {
        companyId,
        chartOfAccountsId,
        name: input.name,
        mainClass: input.mainClass,
        incomeStatementSubItem: input.incomeStatementSubItem,
      },
      include: accountsByNumber,
    });
  },

  async list(companyId: string) {
    return prisma.accountGroup.findMany({
      where: { companyId },
      orderBy: [{ mainClass: 'asc' }, { name: 'asc' }],
      include: accountsByNumber,
    });
  },

  async getById(companyId: string, id: string) {
    const group = await prisma.accountGroup.findFirst({
      where: { id, companyId },
      include: accountsByNumber,
    });
    if (!group) throw AppError.notFound('Account group not found');
    return group;
  },

  async update(companyId: string, id: string, input: AccountGroupInput) {
    assertSubItemMatchesClass(input);
    const group = await prisma.accountGroup.findFirst({ where: { id, companyId } });
    if (!group) throw AppError.notFound('Account group not found');
    if (input.name !== group.name) {
      await assertNameAvailable(companyId, input.name);
    }
    return prisma.accountGroup.update({
      where: { id },
      data: {
        name: input.name,
        mainClass: input.mainClass,
        incomeStatementSubItem: input.incomeStatementSubItem,
      },
      include: accountsByNumber,
    });
  },

  async remove(companyId: string, id: string): Promise<void> {
    const group = await prisma.accountGroup.findFirst({
      where: { id, companyId },
      include: { _count: { select: { accounts: true } } },
    });
    if (!group) throw AppError.notFound('Account group not found');
    if (group._count.accounts > 0) {
      throw AppError.conflict('Account group has accounts and cannot be deleted');
    }
    await prisma.accountGroup.delete({ where: { id } });
  },
};

// A sub-item only means something under its own numbered item of the income
// statement layout; "Eläkekulut" on a revenue group would put the group's
// postings nowhere the report can show them.
function assertSubItemMatchesClass(input: AccountGroupInput): void {
  if (
    input.incomeStatementSubItem &&
    !subItemBelongsTo(input.mainClass, input.incomeStatementSubItem)
  ) {
    throw AppError.badRequest('Income statement sub-item does not belong to the main class');
  }
}

async function assertNameAvailable(companyId: string, name: string): Promise<void> {
  const existing = await prisma.accountGroup.findFirst({ where: { companyId, name } });
  if (existing) throw AppError.conflict('An account group with that name already exists');
}
