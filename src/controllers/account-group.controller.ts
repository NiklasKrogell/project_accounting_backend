import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Account, AccountGroup } from '../generated/prisma/client';
import { accountGroupService } from '../services/account-group.service';
import {
  balanceSheetItemSchema,
  idParamsSchema,
  incomeStatementSubItemSchema,
  mainClassSchema,
} from '../lib/apiSchemas';
import { serializeAccount } from './account.controller';

// incomeStatementSubItem and balanceSheetItem are part of the full-replace
// body: leaving one out on update clears it, like any other omitted optional
// field would.
const groupBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  mainClass: mainClassSchema,
  incomeStatementSubItem: incomeStatementSubItemSchema.nullish().transform((v) => v ?? null),
  balanceSheetItem: balanceSheetItemSchema.nullish().transform((v) => v ?? null),
});

export function serializeAccountGroup(group: AccountGroup & { accounts?: Account[] }) {
  return {
    id: group.id,
    name: group.name,
    mainClass: group.mainClass,
    incomeStatementSubItem: group.incomeStatementSubItem,
    balanceSheetItem: group.balanceSheetItem,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    ...(group.accounts ? { accounts: group.accounts.map(serializeAccount) } : {}),
  };
}

export const accountGroupController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const groups = await accountGroupService.list(companyId);
    res.json({ data: groups.map(serializeAccountGroup) });
  },

  async create(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = groupBodySchema.parse(req.body);
    const group = await accountGroupService.create(companyId, input);
    res.status(201).json({ data: serializeAccountGroup(group) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const group = await accountGroupService.getById(companyId, id);
    res.json({ data: serializeAccountGroup(group) });
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const input = groupBodySchema.parse(req.body);
    const group = await accountGroupService.update(companyId, id, input);
    res.json({ data: serializeAccountGroup(group) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await accountGroupService.remove(companyId, id);
    res.status(204).send();
  },
};
