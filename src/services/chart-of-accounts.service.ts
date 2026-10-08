import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER,
  DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER,
} from '../lib/defaultChartOfAccounts';

// The accounts generated VAT rows post to (see lib/vat.ts); null until set.
export interface VatAccounts {
  vatReceivableAccountId: string | null;
  vatPayableAccountId: string | null;
}

const vatAccountColumns = { vatReceivableAccountId: true, vatPayableAccountId: true } as const;

// Every company has exactly one ChartOfAccounts row (created alongside the
// company); AccountGroup/Account rows reference it via chartOfAccountsId.
export async function getChartOfAccountsId(
  companyId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<string> {
  const chart = await client.chartOfAccounts.findUnique({ where: { companyId } });
  if (!chart) throw AppError.notFound('Chart of accounts not found for this company');
  return chart.id;
}

export const chartOfAccountsService = {
  // Seeds the curated Finnish standard chart for a company that has none yet.
  // Refuses (409) once any group or account exists so it can't clobber a chart
  // the company has started customizing.
  async initializeDefault(companyId: string) {
    return prisma.$transaction(async (tx) => {
      const [groupCount, accountCount] = await Promise.all([
        tx.accountGroup.count({ where: { companyId } }),
        tx.account.count({ where: { companyId } }),
      ]);
      if (groupCount > 0 || accountCount > 0) {
        throw AppError.conflict('Chart of accounts is already initialized');
      }

      const chartOfAccountsId = await getChartOfAccountsId(companyId, tx);

      for (const group of DEFAULT_CHART_OF_ACCOUNTS) {
        const created = await tx.accountGroup.create({
          data: {
            companyId,
            chartOfAccountsId,
            name: group.name,
            mainClass: group.mainClass,
            incomeStatementSubItem: group.subItem ?? null,
            balanceSheetItem: group.balanceSheetItem ?? null,
          },
        });
        await tx.account.createMany({
          data: group.accounts.map((account) => ({
            companyId,
            chartOfAccountsId,
            number: account.number,
            name: account.name,
            accountGroupId: created.id,
          })),
        });
      }

      const vatAccounts = await tx.account.findMany({
        where: {
          companyId,
          number: { in: [DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER, DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER] },
        },
      });
      const idOf = (number: string) => vatAccounts.find((a) => a.number === number)?.id ?? null;
      await tx.chartOfAccounts.update({
        where: { id: chartOfAccountsId },
        data: {
          vatReceivableAccountId: idOf(DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER),
          vatPayableAccountId: idOf(DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER),
        },
      });

      return tx.accountGroup.findMany({
        where: { companyId },
        orderBy: [{ mainClass: 'asc' }, { name: 'asc' }],
        include: { accounts: { orderBy: { number: 'asc' } } },
      });
    });
  },

  async getVatAccounts(companyId: string): Promise<VatAccounts> {
    const chart = await prisma.chartOfAccounts.findUnique({
      where: { companyId },
      select: vatAccountColumns,
    });
    if (!chart) throw AppError.notFound('Chart of accounts not found for this company');
    return chart;
  },

  // Full replace: null clears an account, after which lines with VAT on that
  // side are refused until one is set again.
  async setVatAccounts(companyId: string, input: VatAccounts): Promise<VatAccounts> {
    return prisma.$transaction(async (tx) => {
      const ids = [
        ...new Set(
          [input.vatReceivableAccountId, input.vatPayableAccountId].filter(
            (id): id is string => id !== null,
          ),
        ),
      ];
      const found = await tx.account.count({ where: { id: { in: ids }, companyId } });
      if (found !== ids.length) {
        throw AppError.badRequest('One or more accounts do not exist in this company');
      }
      const chartOfAccountsId = await getChartOfAccountsId(companyId, tx);
      return tx.chartOfAccounts.update({
        where: { id: chartOfAccountsId },
        data: input,
        select: vatAccountColumns,
      });
    });
  },
};
