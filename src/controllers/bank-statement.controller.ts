import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  bankStatementService,
  type BankStatementWithDetails,
} from '../services/bank-statement.service';
import { AppError } from '../lib/AppError';
import { idParamsSchema } from '../lib/apiSchemas';

const listQuerySchema = z.object({
  // 'true' or 'false' picks the posted or the unposted statements; without it
  // the list has both.
  posted: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  take: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

const updateStatementSchema = z
  .object({
    bankAccountId: z.string().uuid().nullable().optional(),
    posted: z.boolean().optional(),
  })
  .strict();

// The statement with what a list row shows of its file and its bank account.
// The file's bytes are read through the file API (GET /api/files/:id/content),
// with the id given here.
function serializeStatement(statement: BankStatementWithDetails) {
  return {
    id: statement.id,
    posted: statement.posted,
    bankAccountId: statement.bankAccountId,
    bankAccount: statement.bankAccount
      ? {
          id: statement.bankAccount.id,
          name: statement.bankAccount.name,
          iban: statement.bankAccount.iban,
          accountId: statement.bankAccount.accountId,
        }
      : null,
    file: {
      id: statement.file.id,
      originalName: statement.file.originalName,
      size: statement.file.size,
    },
    entryCount: statement._count.entries,
    createdAt: statement.createdAt,
    updatedAt: statement.updatedAt,
  };
}

export const bankStatementController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = listQuerySchema.parse(req.query);
    const { statements, total } = await bankStatementService.list(companyId, query);
    res.json({
      data: statements.map(serializeStatement),
      meta: { total, take: query.take, skip: query.skip },
    });
  },

  // Expects uploadSingleFile to have run: the file is in req.file.
  async import(req: Request, res: Response) {
    const { membership, user } = req.auth!;
    if (!req.file) {
      throw AppError.badRequest('A file is required, as the multipart form field "file"');
    }
    const statement = await bankStatementService.import(membership!.companyId, user.id, {
      content: req.file.buffer,
      originalName: req.file.originalname,
    });
    res.status(201).json({ data: serializeStatement(statement) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const statement = await bankStatementService.getById(companyId, id);
    res.json({ data: serializeStatement(statement) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = updateStatementSchema.parse(req.body);
    const statement = await bankStatementService.update(companyId, id, input);
    res.json({ data: serializeStatement(statement) });
  },

  async summary(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const summary = await bankStatementService.summary(companyId, id);
    res.json({ data: summary });
  },
};
