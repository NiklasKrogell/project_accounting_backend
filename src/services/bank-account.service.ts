import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

export interface BankAccountInput {
  name: string;
  iban: string; // already normalized by the controller
  accountId: string;
}

export const bankAccountService = {
  async create(companyId: string, input: BankAccountInput) {
    await assertIbanAvailable(companyId, input.iban);
    await assertAccountInCompany(companyId, input.accountId);
    return prisma.bankAccount.create({
      data: { companyId, name: input.name, iban: input.iban, accountId: input.accountId },
      include: { account: true },
    });
  },

  async list(companyId: string) {
    return prisma.bankAccount.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: { account: true },
    });
  },

  async getById(companyId: string, id: string) {
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      include: { account: true },
    });
    if (!bankAccount) throw AppError.notFound('Bank account not found');
    return bankAccount;
  },

  async update(companyId: string, id: string, input: BankAccountInput) {
    const bankAccount = await prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!bankAccount) throw AppError.notFound('Bank account not found');
    if (input.iban !== bankAccount.iban) {
      await assertIbanAvailable(companyId, input.iban);
    }
    await assertAccountInCompany(companyId, input.accountId);
    return prisma.bankAccount.update({
      where: { id },
      data: { name: input.name, iban: input.iban, accountId: input.accountId },
      include: { account: true },
    });
  },

  async remove(companyId: string, id: string): Promise<void> {
    const bankAccount = await prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!bankAccount) throw AppError.notFound('Bank account not found');
    await prisma.bankAccount.delete({ where: { id } });
  },
};

async function assertIbanAvailable(companyId: string, iban: string): Promise<void> {
  const existing = await prisma.bankAccount.findFirst({ where: { companyId, iban } });
  if (existing) throw AppError.conflict(`A bank account with IBAN ${iban} already exists`);
}

async function assertAccountInCompany(companyId: string, accountId: string): Promise<void> {
  const account = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!account) throw AppError.badRequest('Account does not exist in this company');
}
