import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  DEFAULT_TRADE_PAYABLES_ACCOUNT_NUMBER,
  DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER,
  DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER,
} from '../lib/defaultChartOfAccounts';

// The accounts generated VAT rows post to (see lib/vat.ts); null until set.
export interface VatAccounts {
  vatReceivableAccountId: string | null;
  vatPayableAccountId: string | null;
}

const vatAccountColumns = { vatReceivableAccountId: true, vatPayableAccountId: true } as const;

// The account approved purchase invoices credit their gross total to (see
// lib/purchaseInvoice.ts); null until set.
export interface TradePayablesAccount {
  tradePayablesAccountId: string | null;
}

const tradePayablesColumns = { tradePayablesAccountId: true } as const;

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

      const postingAccounts = await tx.account.findMany({
        where: {
          companyId,
          number: {
            in: [
              DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER,
              DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER,
              DEFAULT_TRADE_PAYABLES_ACCOUNT_NUMBER,
            ],
          },
        },
      });
      const idOf = (number: string) => postingAccounts.find((a) => a.number === number)?.id ?? null;
      await tx.chartOfAccounts.update({
        where: { id: chartOfAccountsId },
        data: {
          vatReceivableAccountId: idOf(DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER),
          vatPayableAccountId: idOf(DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER),
          tradePayablesAccountId: idOf(DEFAULT_TRADE_PAYABLES_ACCOUNT_NUMBER),
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

  async getTradePayablesAccount(companyId: string): Promise<TradePayablesAccount> {
    const chart = await prisma.chartOfAccounts.findUnique({
      where: { companyId },
      select: tradePayablesColumns,
    });
    if (!chart) throw AppError.notFound('Chart of accounts not found for this company');
    return chart;
  },

  // Null clears it, after which purchase invoices can't be approved until one
  // is set again.
  async setTradePayablesAccount(
    companyId: string,
    input: TradePayablesAccount,
  ): Promise<TradePayablesAccount> {
    return prisma.$transaction(async (tx) => {
      if (input.tradePayablesAccountId) {
        const found = await tx.account.count({
          where: { id: input.tradePayablesAccountId, companyId },
        });
        if (found === 0) throw AppError.badRequest('Account does not exist in this company');
      }
      const chartOfAccountsId = await getChartOfAccountsId(companyId, tx);
      return tx.chartOfAccounts.update({
        where: { id: chartOfAccountsId },
        data: input,
        select: tradePayablesColumns,
      });
    });
  },
};
