import type { Prisma, VoucherType } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { addDays, normalizeToUtcDate } from '../lib/dateOnly';
import { toCents } from '../lib/money';
import { assertDateBookable, assertEntryEditable } from './fiscal-guard.service';

export interface JournalEntryLineInput {
  accountId: string;
  amount: number;
  description: string;
  vatRate: number;
  vatAmount: number;
  type: 'debit' | 'credit';
}

export interface CreateJournalEntryInput {
  voucherType: VoucherType;
  date: Date; // UTC midnight
  description: string;
  accountId: string;
  lines: JournalEntryLineInput[];
}

// voucherType is deliberately not updatable: the voucher number belongs to the
// type's numbering series, and moving an entry between series would corrupt it.
export type UpdateJournalEntryInput = Omit<CreateJournalEntryInput, 'voucherType'>;

export interface ListJournalEntriesFilter {
  from?: Date | undefined;
  to?: Date | undefined; // inclusive
  voucherType?: VoucherType | undefined;
  take: number;
  skip: number;
}

const withLines = { lines: true as const };

// Double-entry: debits and credits must balance. Amounts are Floats in the
// schema, so compare in cents to dodge binary rounding (see lib/money.ts).
function validateLinesBalance(lines: JournalEntryLineInput[]): void {
  const debit = lines.filter((l) => l.type === 'debit').reduce((s, l) => s + toCents(l.amount), 0);
  const credit = lines.filter((l) => l.type === 'credit').reduce((s, l) => s + toCents(l.amount), 0);
  if (debit === 0 || credit === 0) {
    throw AppError.badRequest('Entry needs at least one debit and one credit line');
  }
  if (debit !== credit) {
    throw AppError.badRequest(
      `Debit and credit totals must balance (debit ${(debit / 100).toFixed(2)}, credit ${(credit / 100).toFixed(2)})`,
    );
  }
}

// Every referenced account must belong to the caller's company; an id from
// another company is indistinguishable from a nonexistent one.
async function assertAccountsInCompany(
  tx: Prisma.TransactionClient,
  companyId: string,
  accountIds: string[],
): Promise<void> {
  const unique = [...new Set(accountIds)];
  const found = await tx.account.count({ where: { id: { in: unique }, companyId } });
  if (found !== unique.length) {
    throw AppError.badRequest('One or more accounts do not exist in this company');
  }
}

// Allocates the next voucher number for the company + voucher type series.
// The native INSERT ... ON CONFLICT DO UPDATE is atomic and its row lock
// serializes concurrent allocations; numbers are never reused even if the
// entry that consumed one is later deleted.
async function allocateVoucherNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  voucherType: VoucherType,
): Promise<number> {
  const counter = await tx.voucherCounter.upsert({
    where: { companyId_voucherType: { companyId, voucherType } },
    create: { companyId, voucherType, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  return counter.nextNumber - 1;
}

export const journalEntryService = {
  async create(companyId: string, userId: string, input: CreateJournalEntryInput) {
    validateLinesBalance(input.lines);
    const date = normalizeToUtcDate(input.date);

    return prisma.$transaction(async (tx) => {
      await assertDateBookable(companyId, date, tx);
      await assertAccountsInCompany(tx, companyId, [
        input.accountId,
        ...input.lines.map((l) => l.accountId),
      ]);
      const voucherNumber = await allocateVoucherNumber(tx, companyId, input.voucherType);
      return tx.journalEntry.create({
        data: {
          companyId,
          createdById: userId,
          voucherType: input.voucherType,
          voucherNumber,
          date,
          description: input.description,
          accountId: input.accountId,
          lines: { create: input.lines },
        },
        include: withLines,
      });
    });
  },

  async list(companyId: string, filter: ListJournalEntriesFilter) {
    const where: Prisma.JournalEntryWhereInput = { companyId };
    if (filter.from || filter.to) {
      where.date = {
        ...(filter.from ? { gte: filter.from } : {}),
        // Inclusive end date: entry dates are timestamps, so use < to + 1 day.
        ...(filter.to ? { lt: addDays(filter.to, 1) } : {}),
      };
    }
    if (filter.voucherType) where.voucherType = filter.voucherType;

    const [entries, total] = await prisma.$transaction([
      prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: filter.take,
        skip: filter.skip,
        include: withLines,
      }),
      prisma.journalEntry.count({ where }),
    ]);
    return { entries, total };
  },

  async getById(companyId: string, entryId: string) {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, companyId },
      include: withLines,
    });
    if (!entry) throw AppError.notFound('Journal entry not found');
    return entry;
  },

  // Full replace: lines are swapped wholesale, which keeps the API simple and
  // avoids per-line diffing.
  async update(companyId: string, entryId: string, input: UpdateJournalEntryInput) {
    validateLinesBalance(input.lines);
    const newDate = normalizeToUtcDate(input.date);

    return prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({ where: { id: entryId, companyId } });
      if (!entry) throw AppError.notFound('Journal entry not found');
      await assertEntryEditable(companyId, entry.date, tx);
      if (newDate.getTime() !== normalizeToUtcDate(entry.date).getTime()) {
        await assertDateBookable(companyId, newDate, tx);
      }
      await assertAccountsInCompany(tx, companyId, [
        input.accountId,
        ...input.lines.map((l) => l.accountId),
      ]);
      await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
      return tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          date: newDate,
          description: input.description,
          accountId: input.accountId,
          lines: { create: input.lines },
        },
        include: withLines,
      });
    });
  },

  async remove(companyId: string, entryId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({ where: { id: entryId, companyId } });
      if (!entry) throw AppError.notFound('Journal entry not found');
      await assertEntryEditable(companyId, entry.date, tx);
      // Lines have no DB cascade; attachments cascade with the entry.
      await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
      await tx.journalEntry.delete({ where: { id: entry.id } });
    });
  },
};
