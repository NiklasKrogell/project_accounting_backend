import type { Request, Response } from 'express';
import { z } from 'zod';
import { chartOfAccountsService } from '../services/chart-of-accounts.service';
import { serializeAccountGroup } from './account-group.controller';

// Both keys are required: the endpoint is a full replace, and null clears.
const vatAccountsSchema = z.object({
  vatReceivableAccountId: z.string().uuid().nullable(),
  vatPayableAccountId: z.string().uuid().nullable(),
});

// Required for the same reason: null clears.
const tradePayablesAccountSchema = z.object({
  tradePayablesAccountId: z.string().uuid().nullable(),
});

export const chartOfAccountsController = {
  async initialize(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const groups = await chartOfAccountsService.initializeDefault(companyId);
    res.status(201).json({ data: groups.map(serializeAccountGroup) });
  },

  async getVatAccounts(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    res.json({ data: await chartOfAccountsService.getVatAccounts(companyId) });
  },

  async setVatAccounts(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = vatAccountsSchema.parse(req.body);
    res.json({ data: await chartOfAccountsService.setVatAccounts(companyId, input) });
  },

  async getTradePayablesAccount(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    res.json({ data: await chartOfAccountsService.getTradePayablesAccount(companyId) });
  },

  async setTradePayablesAccount(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = tradePayablesAccountSchema.parse(req.body);
    res.json({ data: await chartOfAccountsService.setTradePayablesAccount(companyId, input) });
  },
};
