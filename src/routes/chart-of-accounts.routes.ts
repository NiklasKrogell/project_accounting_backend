import { Router } from 'express';
import { chartOfAccountsController } from '../controllers/chart-of-accounts.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// One-shot seeding of the default Finnish chart for a fresh company.
export const chartOfAccountsRoutes = Router();

chartOfAccountsRoutes.post(
  '/initialize',
  roleAtLeast('LEDGER'),
  asyncHandler(chartOfAccountsController.initialize),
);
