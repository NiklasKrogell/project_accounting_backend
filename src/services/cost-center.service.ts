import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

export interface CostCenterInput {
  code: string;
  name: string;
}

export const costCenterService = {
  async create(companyId: string, input: CostCenterInput) {
    await assertCodeAvailable(companyId, input.code);
    return prisma.costCenter.create({
      data: { companyId, code: input.code, name: input.name },
    });
  },

  async list(companyId: string) {
    return prisma.costCenter.findMany({
      where: { companyId },
      // code is a String, so ordering is lexicographic — consistent with
      // account numbers in accountService.list.
      orderBy: { code: 'asc' },
    });
  },

  async getById(companyId: string, id: string) {
    const costCenter = await prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!costCenter) throw AppError.notFound('Cost center not found');
    return costCenter;
  },

  async update(companyId: string, id: string, input: CostCenterInput) {
    const costCenter = await prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!costCenter) throw AppError.notFound('Cost center not found');
    if (input.code !== costCenter.code) {
      await assertCodeAvailable(companyId, input.code);
    }
    return prisma.costCenter.update({
      where: { id },
      data: { code: input.code, name: input.name },
    });
  },

  async remove(companyId: string, id: string): Promise<void> {
    const costCenter = await prisma.costCenter.findFirst({
      where: { id, companyId },
      include: { _count: { select: { lines: true } } },
    });
    if (!costCenter) throw AppError.notFound('Cost center not found');
    if (costCenter._count.lines > 0) {
      throw AppError.conflict('Cost center is in use and cannot be deleted');
    }
    await prisma.costCenter.delete({ where: { id } });
  },
};

async function assertCodeAvailable(companyId: string, code: string): Promise<void> {
  const existing = await prisma.costCenter.findFirst({ where: { companyId, code } });
  if (existing) throw AppError.conflict('A cost center with that code already exists');
}
