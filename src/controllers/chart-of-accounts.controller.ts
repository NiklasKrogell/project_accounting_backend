import type { Request, Response } from 'express';
import { chartOfAccountsService } from '../services/chart-of-accounts.service';
import { serializeAccountGroup } from './account-group.controller';

export const chartOfAccountsController = {
  async initialize(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const groups = await chartOfAccountsService.initializeDefault(companyId);
    res.status(201).json({ data: groups.map(serializeAccountGroup) });
  },
};
