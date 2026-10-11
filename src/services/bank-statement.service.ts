import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { summarizeStatement } from '../lib/bankStatementSummary';
import { detectMimeType } from '../lib/fileType';
import { storeFile } from './stored-file.service';

// A company's bank statements (tiliotteet): PDFs it has imported, to be booked
// by hand. Nothing is read from the PDF, so a statement knows only its file,
// the bank account it was chosen to be of and whether the user has marked it
// posted. The journal entries booked from it point back at it
// (JournalEntry.bankStatementId, set when the entry is created); they are
// created, changed and deleted through the journal entry API, with its rules.

export interface ImportBankStatementInput {
  content: Buffer;
  // The name the client gave the file; cleaned up before it is stored.
  originalName: string;
}

export interface ListBankStatementsFilter {
  // Only the posted or only the unposted ones; all when left out.
  posted?: boolean | undefined;
  take: number;
  skip: number;
}

export interface UpdateBankStatementInput {
  // Null takes the bank account off; left as it is when omitted.
  bankAccountId?: string | null | undefined;
  posted?: boolean | undefined;
}

const withDetails = {
  file: true,
  bankAccount: true,
  _count: { select: { entries: true } },
} satisfies Prisma.BankStatementInclude;

export type BankStatementWithDetails = Prisma.BankStatementGetPayload<{
  include: typeof withDetails;
}>;

export const bankStatementService = {
  // One PDF is one statement. The file is stored like any other of the
  // company's (see storeFile), with the statement's row written in the same
  // transaction as the file's.
  async import(companyId: string, userId: string, input: ImportBankStatementInput) {
    // An empty file is refused by storeFile, as for every upload.
    if (input.content.length > 0 && detectMimeType(input.content) !== 'application/pdf') {
      throw new AppError(415, 'Unsupported file type: a bank statement must be a PDF');
    }
    return storeFile(companyId, userId, input, (tx, file) =>
      tx.bankStatement.create({
        data: { companyId, fileId: file.id },
        include: withDetails,
      }),
    );
  },

  async list(companyId: string, filter: ListBankStatementsFilter) {
    const where: Prisma.BankStatementWhereInput = { companyId };
    if (filter.posted !== undefined) where.posted = filter.posted;

    const [statements, total] = await prisma.$transaction([
      prisma.bankStatement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: filter.take,
        skip: filter.skip,
        include: withDetails,
      }),
      prisma.bankStatement.count({ where }),
    ]);
    return { statements, total };
  },

  async getById(companyId: string, id: string) {
    const statement = await prisma.bankStatement.findFirst({
      where: { id, companyId },
      include: withDetails,
    });
    if (!statement) throw AppError.notFound('Bank statement not found');
    return statement;
  },

  // The bank account may be one taken out of use: an old statement can still
  // be said to be of it. It must be the company's own; another company's is
  // indistinguishable from a nonexistent one.
  async update(companyId: string, id: string, input: UpdateBankStatementInput) {
    return prisma.$transaction(async (tx) => {
      const statement = await tx.bankStatement.findFirst({ where: { id, companyId } });
      if (!statement) throw AppError.notFound('Bank statement not found');
      if (input.bankAccountId) {
        const bankAccount = await tx.bankAccount.findFirst({
          where: { id: input.bankAccountId, companyId },
          select: { id: true },
        });
        if (!bankAccount) {
          throw AppError.badRequest('Bank account does not exist in this company');
        }
      }
      return tx.bankStatement.update({
        where: { id: statement.id },
        data: {
          ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
          ...(input.posted !== undefined ? { posted: input.posted } : {}),
        },
        include: withDetails,
      });
    });
  },

  // What has been booked from the statement so far (see
  // lib/bankStatementSummary.ts). The entry's own companyId is in the query as
  // well, so a line is never summed on the strength of a statement id alone.
  async summary(companyId: string, id: string) {
    const statement = await prisma.bankStatement.findFirst({
      where: { id, companyId },
      select: { id: true, bankAccount: { select: { accountId: true } } },
    });
    if (!statement) throw AppError.notFound('Bank statement not found');
    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntry: { bankStatementId: statement.id, companyId } },
      select: {
        accountId: true,
        amount: true,
        type: true,
        vatRate: true,
        vatAmount: true,
        isVat: true,
      },
    });
    return summarizeStatement(lines, statement.bankAccount?.accountId ?? null);
  },
};
