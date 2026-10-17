import type { Request, Response } from 'express';
import { z } from 'zod';
import type { JournalEntry, JournalEntryLine } from '../generated/prisma/client';
import { journalEntryService } from '../services/journal-entry.service';
import { formatDateOnly } from '../lib/dateOnly';
import { dateOnlySchema, idParamsSchema } from '../lib/apiSchemas';

const voucherTypeSchema = z.enum([
  'SALES',
  'PURCHASE',
  'PAYMENT',
  'EXPENSE',
  'WAGE',
  'MEMOVOUCHER',
]);

// Lines are the entered ones only, their amounts net of VAT or including it
// according to the entry-level vatBasis. The VAT amount and the VAT rows are
// derived by the service, so a vatAmount or isVat in the body is stripped,
// not stored. With automaticVat off no VAT rows are derived: the caller books
// the VAT as lines of its own.
const lineSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().trim().max(500).default(''),
  vatRate: z.number().min(0).max(100),
  type: z.enum(['debit', 'credit']),
  costCenterId: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

const createEntrySchema = z.object({
  voucherType: voucherTypeSchema,
  date: dateOnlySchema,
  description: z.string().trim().min(1).max(500),
  accountId: z.string().uuid(),
  vatBasis: z.enum(['net', 'gross']).default('net'),
  automaticVat: z.boolean().default(true),
  // The bank statement the entry is booked from; given only when creating.
  bankStatementId: z.string().uuid().optional(),
  // The statement transaction the entry books; given only when creating.
  bankStatementLineId: z.string().uuid().optional(),
  lines: z.array(lineSchema).min(2).max(100),
});

const updateEntrySchema = createEntrySchema.omit({
  voucherType: true,
  bankStatementId: true,
  bankStatementLineId: true,
});

const listQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  voucherType: voucherTypeSchema.optional(),
  bankStatementId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

function serializeEntry(entry: JournalEntry & { lines: JournalEntryLine[] }) {
  return {
    id: entry.id,
    voucherType: entry.voucherType,
    voucherNumber: entry.voucherNumber,
    date: formatDateOnly(entry.date),
    description: entry.description,
    accountId: entry.accountId,
    bankStatementId: entry.bankStatementId,
    createdById: entry.createdById,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lines: entry.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      amount: line.amount,
      description: line.description,
      vatRate: line.vatRate,
      vatAmount: line.vatAmount,
      type: line.type,
      isVat: line.isVat,
      costCenterId: line.costCenterId,
    })),
  };
}

export const journalEntryController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = listQuerySchema.parse(req.query);
    const { entries, total } = await journalEntryService.list(companyId, query);
    res.json({ data: entries.map(serializeEntry), meta: { total, take: query.take, skip: query.skip } });
  },

  async create(req: Request, res: Response) {
    const { membership, user } = req.auth!;
    const input = createEntrySchema.parse(req.body);
    const entry = await journalEntryService.create(membership!.companyId, user.id, input);
    res.status(201).json({ data: serializeEntry(entry) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const entry = await journalEntryService.getById(companyId, id);
    res.json({ data: serializeEntry(entry) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = updateEntrySchema.parse(req.body);
    const entry = await journalEntryService.update(companyId, id, input);
    res.json({ data: serializeEntry(entry) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await journalEntryService.remove(companyId, id);
    res.status(204).send();
  },
};
