import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

export interface BankAccountInput {
  name: string;
  iban: string; // already normalized by the controller
  accountId: string;
}

export interface BankAccountUpdateInput extends BankAccountInput {
  // Left as it is when omitted.
  isActive?: boolean | undefined;
}

// Bank accounts are never deleted: one that is no longer needed is taken out
// of use (isActive = false) and keeps its IBAN reserved.
export const bankAccountService = {
  async create(companyId: string, input: BankAccountInput) {
    await assertIbanAvailable(companyId, input.iban);
    await assertCashAndBankAccount(companyId, input.accountId);
    return prisma.bankAccount.create({
      data: { companyId, name: input.name, iban: input.iban, accountId: input.accountId },
      include: { account: true },
    });
  },

  async list(companyId: string) {
    return prisma.bankAccount.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
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

  async update(companyId: string, id: string, input: BankAccountUpdateInput) {
    const bankAccount = await prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!bankAccount) throw AppError.notFound('Bank account not found');
    if (input.iban !== bankAccount.iban) {
      await assertIbanAvailable(companyId, input.iban);
    }
    // Only a newly picked account is checked, so a bank account whose account
    // was valid when linked (or predates the rule) can still be renamed and
    // taken out of use.
    if (input.accountId !== bankAccount.accountId) {
      await assertCashAndBankAccount(companyId, input.accountId);
    }
    return prisma.bankAccount.update({
      where: { id },
      data: {
        name: input.name,
        iban: input.iban,
        accountId: input.accountId,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { account: true },
    });
  },
};

async function assertIbanAvailable(companyId: string, iban: string): Promise<void> {
  const existing = await prisma.bankAccount.findFirst({ where: { companyId, iban } });
  if (existing) throw AppError.conflict(`A bank account with IBAN ${iban} already exists`);
}

// A bank account is booked on an account of the balance sheet item "Rahat ja
// pankkisaamiset", i.e. one whose group is classified as CASH_AND_BANK. The UI
// offers only those accounts.
async function assertCashAndBankAccount(companyId: string, accountId: string): Promise<void> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, companyId },
    include: { accountGroup: true },
  });
  if (!account) throw AppError.badRequest('Account does not exist in this company');
  if (account.accountGroup?.balanceSheetItem !== 'CASH_AND_BANK') {
    throw AppError.badRequest(
      'Account must be under the balance sheet item "Cash in hand and at banks"',
    );
  }
}
