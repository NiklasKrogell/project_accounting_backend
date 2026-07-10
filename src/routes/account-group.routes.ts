import { Router } from 'express';
import { accountGroupController } from '../controllers/account-group.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// LEDGER and above manage the chart; VIEWER may read it.
export const accountGroupRoutes = Router();

accountGroupRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(accountGroupController.list));
accountGroupRoutes.post('/', roleAtLeast('LEDGER'), asyncHandler(accountGroupController.create));
accountGroupRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(accountGroupController.get));
accountGroupRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(accountGroupController.update));
accountGroupRoutes.delete('/:id', roleAtLeast('LEDGER'), asyncHandler(accountGroupController.remove));
