import { Router } from 'express';
import { accountingPeriodController } from '../controllers/accounting-period.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Periods are created automatically with their fiscal year; only their
// open/closed status is managed here.
export const accountingPeriodRoutes = Router();

accountingPeriodRoutes.post('/:id/close', roleAtLeast('ACCOUNTANT'), asyncHandler(accountingPeriodController.close));
accountingPeriodRoutes.post('/:id/reopen', roleAtLeast('ACCOUNTANT'), asyncHandler(accountingPeriodController.reopen));
