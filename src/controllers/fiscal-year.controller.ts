import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AccountingPeriod, FiscalYear } from '../generated/prisma/client';
import { fiscalYearService } from '../services/fiscal-year.service';
import { formatDateOnly, parseDateOnly } from '../lib/dateOnly';

// Accounting dates travel through the API as 'YYYY-MM-DD' strings; see
// src/lib/dateOnly.ts for the semantics.
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
  .transform((value, ctx) => {
    try {
      return parseDateOnly(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid calendar date' });
      return z.NEVER;
    }
  });

const createFiscalYearSchema = z.object({
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  granularity: z.enum(['MONTH', 'QUARTER']),
});

export const idParamsSchema = z.object({ id: z.string().uuid() });

export function serializeAccountingPeriod(period: AccountingPeriod) {
  return {
    id: period.id,
    fiscalYearId: period.fiscalYearId,
    index: period.index,
    startDate: formatDateOnly(period.startDate),
    endDate: formatDateOnly(period.endDate),
    status: period.status,
    closedAt: period.closedAt,
  };
}

function serializeFiscalYear(fiscalYear: FiscalYear & { periods: AccountingPeriod[] }) {
  return {
    id: fiscalYear.id,
    startDate: formatDateOnly(fiscalYear.startDate),
    endDate: formatDateOnly(fiscalYear.endDate),
    status: fiscalYear.status,
    granularity: fiscalYear.granularity,
    closedAt: fiscalYear.closedAt,
    periods: fiscalYear.periods.map(serializeAccountingPeriod),
  };
}

export const fiscalYearController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const fiscalYears = await fiscalYearService.list(companyId);
    res.json({ data: fiscalYears.map(serializeFiscalYear) });
  },

  async create(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const input = createFiscalYearSchema.parse(req.body);
    const fiscalYear = await fiscalYearService.create(companyId, input);
    res.status(201).json({ data: serializeFiscalYear(fiscalYear) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const fiscalYear = await fiscalYearService.getById(companyId, id);
    res.json({ data: serializeFiscalYear(fiscalYear) });
  },

  async close(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const fiscalYear = await fiscalYearService.close(companyId, id);
    res.json({ data: serializeFiscalYear(fiscalYear) });
  },

  async reopen(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    const fiscalYear = await fiscalYearService.reopen(companyId, id);
    res.json({ data: serializeFiscalYear(fiscalYear) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { id } = idParamsSchema.parse(req.params);
    await fiscalYearService.remove(companyId, id);
    res.status(204).send();
  },
};
