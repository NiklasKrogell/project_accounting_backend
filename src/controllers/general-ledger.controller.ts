import type { Request, Response } from 'express';
import { z } from 'zod';
import { generalLedgerService } from '../services/general-ledger.service';
import { dateOnlySchema } from '../lib/apiSchemas';
import { formatDateOnly } from '../lib/dateOnly';

// take is capped lower than the journal list's 500 because one item here is a
// whole account and can carry hundreds of lines.
const listQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    accountId: z.string().uuid().optional(),
    take: z.coerce.number().int().min(1).max(200).default(50),
    skip: z.coerce.number().int().min(0).default(0),
  })
  // The journal list doesn't check range order, but on a report an inverted
  // range silently returns an empty ledger, which reads as data loss.
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

type LedgerResult = Awaited<ReturnType<typeof generalLedgerService.list>>;

// Report DTO, not an entity serializer: every key is always present (notably
// accountGroup, which is null for ungrouped accounts rather than omitted), and
// each line exposes debit/credit as separate amounts so the view needs no sign
// logic of its own.
function serializeLedger(ledger: LedgerResult['ledgers'][number]) {
  const { account } = ledger;
  return {
    accountId: account.id,
    accountNumber: account.number,
    accountName: account.name,
    accountGroup: account.accountGroup
      ? {
          id: account.accountGroup.id,
          name: account.accountGroup.name,
          mainClass: account.accountGroup.mainClass,
        }
      : null,
    openingBalance: ledger.openingBalance,
    debitTotal: ledger.debitTotal,
    creditTotal: ledger.creditTotal,
    closingBalance: ledger.closingBalance,
    lineCount: ledger.lines.length,
    lines: ledger.lines.map((line) => ({
      id: line.id,
      entryId: line.journalEntry.id,
      date: formatDateOnly(line.journalEntry.date),
      voucherType: line.journalEntry.voucherType,
      voucherNumber: line.journalEntry.voucherNumber,
      entryDescription: line.journalEntry.description,
      description: line.description,
      debit: line.type === 'debit' ? line.amount : 0,
      credit: line.type === 'credit' ? line.amount : 0,
      vatRate: line.vatRate,
      vatAmount: line.vatAmount,
      runningBalance: line.runningBalance,
    })),
  };
}

export const generalLedgerController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = listQuerySchema.parse(req.query);
    const { ledgers, total } = await generalLedgerService.list(companyId, query);
    res.json({
      data: ledgers.map(serializeLedger),
      // total counts ACCOUNTS, matching pagination-by-account.
      meta: { total, take: query.take, skip: query.skip },
    });
  },
};
