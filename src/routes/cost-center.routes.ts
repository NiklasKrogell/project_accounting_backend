import { Router } from 'express';
import { costCenterController } from '../controllers/cost-center.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// LEDGER and above manage cost centers; VIEWER may read them.
export const costCenterRoutes = Router();

costCenterRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(costCenterController.list));
costCenterRoutes.post('/', roleAtLeast('LEDGER'), asyncHandler(costCenterController.create));
costCenterRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(costCenterController.get));
costCenterRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(costCenterController.update));
costCenterRoutes.delete('/:id', roleAtLeast('LEDGER'), asyncHandler(costCenterController.remove));
