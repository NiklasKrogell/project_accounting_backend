import type { Request, Response } from 'express';
import { z } from 'zod';
import { balanceSheetService } from '../services/balance-sheet.service';
import { dateOnlySchema } from '../lib/apiSchemas';
import { formatDateOnly } from '../lib/dateOnly';

// A balance sheet is the state of the books at the end of one day, so it
// takes a date, not a range. The comparison date is the caller's choice (the
// UI derives it from the fiscal years).
const querySchema = z.object({
  date: dateOnlySchema,
  compareDate: dateOnlySchema.optional(),
});

export const balanceSheetController = {
  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = querySchema.parse(req.query);

    const sheet = await balanceSheetService.get(companyId, {
      date: query.date,
      comparisonDate: query.compareDate,
    });

    // Every item of the layout is returned, including empty ones: which items
    // to leave out depends on both columns and is a presentation decision.
    res.json({
      data: {
        date: formatDateOnly(query.date),
        comparisonDate: query.compareDate ? formatDateOnly(query.compareDate) : null,
        ...sheet,
      },
    });
  },
};
