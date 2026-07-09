import { Router } from 'express';
import { fiscalYearController } from '../controllers/fiscal-year.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Reading is open to all members; managing the fiscal calendar requires
// ACCOUNTANT or better.
export const fiscalYearRoutes = Router();

fiscalYearRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(fiscalYearController.list));
fiscalYearRoutes.post('/', roleAtLeast('ACCOUNTANT'), asyncHandler(fiscalYearController.create));
fiscalYearRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(fiscalYearController.get));
fiscalYearRoutes.post('/:id/close', roleAtLeast('ACCOUNTANT'), asyncHandler(fiscalYearController.close));
fiscalYearRoutes.post('/:id/reopen', roleAtLeast('ACCOUNTANT'), asyncHandler(fiscalYearController.reopen));
fiscalYearRoutes.delete('/:id', roleAtLeast('ACCOUNTANT'), asyncHandler(fiscalYearController.remove));
