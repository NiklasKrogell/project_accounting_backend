import { z } from 'zod';
import { parseDateOnly } from './dateOnly';

// Zod schemas shared across controllers.

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

export const idParamsSchema = z.object({ id: z.string().uuid() });
