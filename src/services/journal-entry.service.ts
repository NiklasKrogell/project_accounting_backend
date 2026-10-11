import type { Prisma, VoucherType } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { addDays, normalizeToUtcDate } from '../lib/dateOnly';
import { toCents } from '../lib/money';
import { buildVatLines, splitVat, type GeneratedVatLine, type VatBasis } from '../lib/vat';
import { companySettingsService } from './company-settings.service';
import { assertDateBookable, assertEntryEditable } from './fiscal-guard.service';

// A line as the caller enters it. Whether the amount is net of VAT or includes
// it is the entry-level vatBasis; the stored net amount, the VAT amount and
// (unless automaticVat is off) the VAT rows are derived here (see lib/vat.ts),
// never taken from the caller.
export interface JournalEntryLineInput {
  accountId: string;
  amount: number;
  description: string;
  vatRate: number;
  type: 'debit' | 'credit';
  costCenterId?: string | null;
}

export interface CreateJournalEntryInput {
  voucherType: VoucherType;
  date: Date; // UTC midnight
  description: string;
  accountId: string;
  // How the line amounts are entered; net when left out.
  vatBasis?: VatBasis | undefined;
  // Whether VAT rows are generated from the lines; on when left out. Off, the
  // caller books the VAT itself: the lines are stored as entered and must
  // balance as entered, and a line's vatRate and vatAmount only describe it.
  automaticVat?: boolean | undefined;
  lines: JournalEntryLineInput[];
}

// How an entry's VAT is handled, with the input's defaults applied. Without
// automatic VAT nothing is taken out of an amount, so the basis is always net.
interface VatHandling {
  automatic: boolean;
  basis: VatBasis;
}

function vatHandlingOf(input: Pick<CreateJournalEntryInput, 'vatBasis' | 'automaticVat'>): VatHandling {
  const automatic = input.automaticVat ?? true;
  return { automatic, basis: automatic ? (input.vatBasis ?? 'net') : 'net' };
}

function vatLinesOf(entered: JournalEntryLineInput[], vat: VatHandling) {
  return vat.automatic ? buildVatLines(entered, vat.basis) : [];
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

// Double-entry: debits and credits must balance, with the VAT rows the lines
// generate counted on their side. Amounts are Floats in the schema, so compare
// in cents to dodge binary rounding (see lib/money.ts).
function validateLinesBalance(entered: JournalEntryLineInput[], vat: VatHandling): void {
  const lines = [
    ...entered.map((l) => ({ type: l.type, amount: splitVat(l, vat.basis).net })),
    ...vatLinesOf(entered, vat),
  ];
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

// Same rule for the optional cost centers on the lines.
async function assertCostCentersInCompany(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: JournalEntryLineInput[],
): Promise<void> {
  const unique = [
    ...new Set(lines.map((l) => l.costCenterId).filter((id): id is string => id != null)),
  ];
  if (unique.length === 0) return;
  const found = await tx.costCenter.count({ where: { id: { in: unique }, companyId } });
  if (found !== unique.length) {
    throw AppError.badRequest('One or more cost centers do not exist in this company');
  }
}

// A company that is not VAT-registered books no VAT at all, so none of its
// lines may carry a VAT rate — with automatic VAT off as well, where the rate
// would only describe the line.
async function assertVatAllowed(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: JournalEntryLineInput[],
): Promise<void> {
  if (lines.every((l) => l.vatRate === 0)) return;
  const { vatRegistered } = await companySettingsService.get(companyId, tx);
  if (!vatRegistered) {
    throw AppError.badRequest(
      'The company is not VAT-registered, so entry lines cannot have a VAT rate',
    );
  }
}

// The rows to store for an entry: the entered lines at their net amount with
// their VAT amount, followed by the VAT rows they generate on the company's
// VAT accounts (none when automatic VAT is off).
async function buildStoredLines(
  tx: Prisma.TransactionClient,
  companyId: string,
  entered: JournalEntryLineInput[],
  vat: VatHandling,
) {
  const vatLines = await resolveVatAccounts(tx, companyId, vatLinesOf(entered, vat));
  return [
    ...entered.map((line) => {
      const split = splitVat(line, vat.basis);
      return {
        accountId: line.accountId,
        amount: split.net,
        description: line.description,
        vatRate: line.vatRate,
        vatAmount: split.vat,
        type: line.type,
        costCenterId: line.costCenterId ?? null,
        isVat: false,
      };
    }),
    ...vatLines,
  ];
}

// A VAT row carries no VAT rate or VAT amount of its own, and keeps the cost
// center of the line it was computed from (already checked to be the
// company's, with the entered lines).
async function resolveVatAccounts(
  tx: Prisma.TransactionClient,
  companyId: string,
  vatLines: GeneratedVatLine[],
) {
  if (vatLines.length === 0) return [];
  const chart = await tx.chartOfAccounts.findUnique({
    where: { companyId },
    select: { vatReceivableAccountId: true, vatPayableAccountId: true },
  });
  return vatLines.map((line) => {
    const accountId =
      line.vatAccount === 'receivable' ? chart?.vatReceivableAccountId : chart?.vatPayableAccountId;
    if (!accountId) {
      throw AppError.badRequest(
        `VAT ${line.vatAccount} account is not set in the chart of accounts`,
      );
    }
    return {
      accountId,
      amount: line.amount,
      description: line.description,
      vatRate: 0,
      vatAmount: 0,
      type: line.type,
      costCenterId: line.costCenterId,
      isVat: true,
    };
  });
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
    const vat = vatHandlingOf(input);
    validateLinesBalance(input.lines, vat);
    const date = normalizeToUtcDate(input.date);

    return prisma.$transaction(async (tx) => {
      await assertDateBookable(companyId, date, tx);
      await assertAccountsInCompany(tx, companyId, [
        input.accountId,
        ...input.lines.map((l) => l.accountId),
      ]);
      await assertCostCentersInCompany(tx, companyId, input.lines);
      await assertVatAllowed(tx, companyId, input.lines);
      const lines = await buildStoredLines(tx, companyId, input.lines, vat);
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
          lines: { create: lines },
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
  // avoids per-line diffing. The VAT rows go with them and are generated anew.
  async update(companyId: string, entryId: string, input: UpdateJournalEntryInput) {
    const vat = vatHandlingOf(input);
    validateLinesBalance(input.lines, vat);
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
      await assertCostCentersInCompany(tx, companyId, input.lines);
      await assertVatAllowed(tx, companyId, input.lines);
      const lines = await buildStoredLines(tx, companyId, input.lines, vat);
      await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
      return tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          date: newDate,
          description: input.description,
          accountId: input.accountId,
          lines: { create: lines },
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
      // Lines have no DB cascade. The entry's files are not deleted with it:
      // the database unlinks them (StoredFile.journalEntryId, SetNull) and
      // they stay with the company.
      await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
      await tx.journalEntry.delete({ where: { id: entry.id } });
    });
  },
};
