import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../lib/defaultChartOfAccounts';

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
          data: { companyId, chartOfAccountsId, name: group.name, mainClass: group.mainClass },
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

      return tx.accountGroup.findMany({
        where: { companyId },
        orderBy: [{ mainClass: 'asc' }, { name: 'asc' }],
        include: { accounts: { orderBy: { number: 'asc' } } },
      });
    });
  },
};
