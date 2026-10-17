import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  bankStatementLineService,
  type BankStatementLineWithEntry,
  type CsvUpload,
} from '../services/bank-statement-line.service';
import { AppError } from '../lib/AppError';
import { idParamsSchema } from '../lib/apiSchemas';
import { CSV_FIELDS, type CsvMapping, type ParsedLine } from '../lib/bankCsv';
import { formatDateOnly } from '../lib/dateOnly';
import { fromCents } from '../lib/money';

const lineParamsSchema = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });

// The columns chosen for each field, as the form field `mapping` (JSON) sent
// with the file. Left out, the guessed ones are used.
const columnsSchema = z.array(z.number().int().min(0).max(499)).max(10);
const mappingSchema = z
  .object(Object.fromEntries(CSV_FIELDS.map((field) => [field, columnsSchema.optional()])))
  .strict();

const uploadFieldsSchema = z.object({
  mapping: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return undefined;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mapping must be JSON' });
        return z.NEVER;
      }
    })
    .pipe(mappingSchema.optional()),
});

function uploadOf(req: Request): { upload: CsvUpload; mapping: CsvMapping | undefined } {
  const { mapping } = uploadFieldsSchema.parse(req.body ?? {});
  if (!req.file) {
    throw AppError.badRequest('A file is required, as the multipart form field "file"');
  }
  return {
    upload: { content: req.file.buffer, originalName: req.file.originalname },
    mapping: mapping as CsvMapping | undefined,
  };
}

function serializeParsedLine(line: ParsedLine & { duplicate: boolean }) {
  const { amountCents, ...rest } = line;
  return { ...rest, amount: fromCents(amountCents) };
}

export function serializeLine(line: BankStatementLineWithEntry) {
  return {
    id: line.id,
    position: line.position,
    bookingDate: formatDateOnly(line.bookingDate),
    valueDate: line.valueDate ? formatDateOnly(line.valueDate) : null,
    amount: line.amount,
    counterparty: line.counterparty,
    counterpartyAccount: line.counterpartyAccount,
    reference: line.reference,
    message: line.message,
    transactionType: line.transactionType,
    archiveId: line.archiveId,
    journalEntry: line.journalEntry,
  };
}

export const bankStatementLineController = {
  // Expects uploadSingleFile to have run.
  async preview(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const { upload, mapping } = uploadOf(req);
    const preview = await bankStatementLineService.preview(companyId, id, upload, mapping);
    res.json({ data: { ...preview, lines: preview.lines.map(serializeParsedLine) } });
  },

  // Expects uploadSingleFile to have run.
  async import(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const { upload, mapping } = uploadOf(req);
    const result = await bankStatementLineService.import(companyId, id, upload, mapping);
    res.status(201).json({ data: result });
  },

  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const lines = await bankStatementLineService.list(companyId, id);
    res.json({ data: lines.map(serializeLine) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id, lineId } = lineParamsSchema.parse(req.params);
    await bankStatementLineService.remove(companyId, id, lineId);
    res.status(204).send();
  },
};
