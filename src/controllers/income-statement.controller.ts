import type { Request, Response } from 'express';
import { z } from 'zod';
import { incomeStatementService } from '../services/income-statement.service';
import { dateOnlySchema } from '../lib/apiSchemas';
import { formatDateOnly } from '../lib/dateOnly';

// Unlike the general ledger, the period is required: an income statement
// without a period is not a meaningful report. The comparison period is the
// caller's choice (the UI derives it from the fiscal years) and is given as
// both dates or neither.
const querySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    compareFrom: dateOnlySchema.optional(),
    compareTo: dateOnlySchema.optional(),
    costCenterId: z.string().uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to', path: ['from'] })
  .refine((q) => (q.compareFrom === undefined) === (q.compareTo === undefined), {
    message: 'compareFrom and compareTo must be given together',
    path: ['compareFrom'],
  })
  .refine((q) => !q.compareFrom || !q.compareTo || q.compareFrom <= q.compareTo, {
    message: 'compareFrom must not be after compareTo',
    path: ['compareFrom'],
  });

export const incomeStatementController = {
  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = querySchema.parse(req.query);
    const comparison =
      query.compareFrom && query.compareTo
        ? { from: query.compareFrom, to: query.compareTo }
        : undefined;

    const statement = await incomeStatementService.get(companyId, {
      period: { from: query.from, to: query.to },
      comparison,
      costCenterId: query.costCenterId,
    });

    // Every item of the layout is returned, including empty ones: which items
    // to leave out depends on both columns and is a presentation decision.
    res.json({
      data: {
        period: { from: formatDateOnly(query.from), to: formatDateOnly(query.to) },
        comparison: comparison
          ? { from: formatDateOnly(comparison.from), to: formatDateOnly(comparison.to) }
          : null,
        costCenterId: query.costCenterId ?? null,
        ...statement,
      },
    });
  },
};
