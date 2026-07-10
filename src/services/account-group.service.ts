import type { AccountMainClass } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

const accountsByNumber = { accounts: { orderBy: { number: 'asc' as const } } };

export interface AccountGroupInput {
  name: string;
  mainClass: AccountMainClass;
}

export const accountGroupService = {
  async create(companyId: string, input: AccountGroupInput) {
    await assertNameAvailable(companyId, input.name);
    return prisma.accountGroup.create({
      data: { companyId, name: input.name, mainClass: input.mainClass },
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
    const group = await prisma.accountGroup.findFirst({ where: { id, companyId } });
    if (!group) throw AppError.notFound('Account group not found');
    if (input.name !== group.name) {
      await assertNameAvailable(companyId, input.name);
    }
    return prisma.accountGroup.update({
      where: { id },
      data: { name: input.name, mainClass: input.mainClass },
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

async function assertNameAvailable(companyId: string, name: string): Promise<void> {
  const existing = await prisma.accountGroup.findFirst({ where: { companyId, name } });
  if (existing) throw AppError.conflict('An account group with that name already exists');
}
