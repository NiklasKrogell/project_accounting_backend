import type { Request, Response } from 'express';
import { accountingPeriodService } from '../services/accounting-period.service';
import { idParamsSchema } from '../lib/apiSchemas';
import { serializeAccountingPeriod } from './fiscal-year.controller';

export const accountingPeriodController = {
  async close(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const period = await accountingPeriodService.closePeriod(companyId, id);
    res.json({ data: serializeAccountingPeriod(period) });
  },

  async reopen(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const period = await accountingPeriodService.reopenPeriod(companyId, id);
    res.json({ data: serializeAccountingPeriod(period) });
  },
};
