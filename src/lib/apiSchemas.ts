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

// Mirrors the AccountMainClass Prisma enum; kept here so controllers validate
// against it without importing the generated client.
export const mainClassSchema = z.enum([
  'REVENUE',
  'MATERIALS_AND_SERVICES',
  'PERSONNEL_EXPENSES',
  'DEPRECIATION',
  'OTHER_OPERATING_EXPENSES',
  'FINANCIAL_INCOME_AND_EXPENSES',
  'APPROPRIATIONS_AND_TAXES',
  'FIXED_ASSETS',
  'CURRENT_ASSETS',
  'EQUITY',
  'PROVISIONS',
  'LIABILITIES',
]);
