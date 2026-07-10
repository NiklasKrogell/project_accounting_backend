import { Router } from 'express';
import { accountController } from '../controllers/account.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
export const accountRoutes = Router();

accountRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(accountController.list));
accountRoutes.post('/', roleAtLeast('LEDGER'), asyncHandler(accountController.create));
accountRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(accountController.get));
accountRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(accountController.update));
accountRoutes.delete('/:id', roleAtLeast('LEDGER'), asyncHandler(accountController.remove));
