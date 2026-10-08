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
  'CHANGE_IN_FINISHED_GOODS_INVENTORIES',
  'PRODUCTION_FOR_OWN_USE',
  'OTHER_OPERATING_INCOME',
  'MATERIALS_AND_SERVICES',
  'PERSONNEL_EXPENSES',
  'DEPRECIATION',
  'OTHER_OPERATING_EXPENSES',
  'FINANCIAL_INCOME_AND_EXPENSES',
  'APPROPRIATIONS',
  'INCOME_TAXES',
  'OTHER_DIRECT_TAXES',
  'FIXED_ASSETS',
  'CURRENT_ASSETS',
  'EQUITY',
  'PROVISIONS',
  'LIABILITIES',
]);

// Mirrors the IncomeStatementSubItem Prisma enum, for the same reason.
export const incomeStatementSubItemSchema = z.enum([
  'PURCHASES',
  'CHANGE_IN_INVENTORIES',
  'EXTERNAL_SERVICES',
  'WAGES_AND_SALARIES',
  'PENSION_EXPENSES',
  'OTHER_SOCIAL_SECURITY_EXPENSES',
  'PLANNED_DEPRECIATION',
  'IMPAIRMENT_OF_FIXED_ASSETS',
  'EXCEPTIONAL_IMPAIRMENT_OF_CURRENT_ASSETS',
  'INCOME_FROM_GROUP_UNDERTAKINGS',
  'INCOME_FROM_PARTICIPATING_INTERESTS',
  'INCOME_FROM_OTHER_FIXED_ASSET_INVESTMENTS',
  'INCOME_FROM_OTHER_FIXED_ASSET_INVESTMENTS_GROUP_UNDERTAKINGS',
  'OTHER_INTEREST_AND_FINANCIAL_INCOME',
  'OTHER_INTEREST_AND_FINANCIAL_INCOME_GROUP_UNDERTAKINGS',
  'IMPAIRMENT_OF_FIXED_ASSET_INVESTMENTS',
  'IMPAIRMENT_OF_CURRENT_ASSET_SECURITIES',
  'INTEREST_AND_OTHER_FINANCIAL_EXPENSES',
  'INTEREST_AND_OTHER_FINANCIAL_EXPENSES_GROUP_UNDERTAKINGS',
  'CHANGE_IN_DEPRECIATION_DIFFERENCE',
  'CHANGE_IN_TAX_BASED_PROVISIONS',
  'GROUP_CONTRIBUTION',
]);
