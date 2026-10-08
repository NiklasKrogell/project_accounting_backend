import { Router } from 'express';
import { chartOfAccountsController } from '../controllers/chart-of-accounts.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// One-shot seeding of the default Finnish chart for a fresh company, and the
// chart's VAT accounts.
export const chartOfAccountsRoutes = Router();

chartOfAccountsRoutes.post(
  '/initialize',
  roleAtLeast('LEDGER'),
  asyncHandler(chartOfAccountsController.initialize),
);
chartOfAccountsRoutes.get(
  '/vat-accounts',
  roleAtLeast('VIEWER'),
  asyncHandler(chartOfAccountsController.getVatAccounts),
);
chartOfAccountsRoutes.put(
  '/vat-accounts',
  roleAtLeast('LEDGER'),
  asyncHandler(chartOfAccountsController.setVatAccounts),
);
