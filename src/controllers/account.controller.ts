import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Account, AccountGroup } from '../generated/prisma/client';
import { accountService } from '../services/account.service';
import { idParamsSchema, mainClassSchema } from '../lib/apiSchemas';

const accountBodySchema = z.object({
  number: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  accountGroupId: z.string().uuid().nullish(),
});

const listQuerySchema = z.object({
  accountGroupId: z.string().uuid().optional(),
  mainClass: mainClassSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export function serializeAccount(account: Account & { accountGroup?: AccountGroup | null }) {
  return {
    id: account.id,
    number: account.number,
    name: account.name,
    accountGroupId: account.accountGroupId,
    ...(account.accountGroup !== undefined
      ? {
          accountGroup: account.accountGroup
            ? {
                id: account.accountGroup.id,
                name: account.accountGroup.name,
                mainClass: account.accountGroup.mainClass,
              }
            : null,
        }
      : {}),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export const accountController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const filter = listQuerySchema.parse(req.query);
    const accounts = await accountService.list(companyId, filter);
    res.json({ data: accounts.map(serializeAccount) });
  },

  async create(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = accountBodySchema.parse(req.body);
    const account = await accountService.create(companyId, input);
    res.status(201).json({ data: serializeAccount(account) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const account = await accountService.getById(companyId, id);
    res.json({ data: serializeAccount(account) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = accountBodySchema.parse(req.body);
    const account = await accountService.update(companyId, id, input);
    res.json({ data: serializeAccount(account) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await accountService.remove(companyId, id);
    res.status(204).send();
  },
};
