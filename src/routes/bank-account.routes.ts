import { Router } from 'express';
import { bankAccountController } from '../controllers/bank-account.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription). There
// is no DELETE: a bank account is taken out of use through PUT (isActive).
export const bankAccountRoutes = Router();

bankAccountRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(bankAccountController.list));
bankAccountRoutes.post('/', roleAtLeast('LEDGER'), asyncHandler(bankAccountController.create));
bankAccountRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(bankAccountController.get));
bankAccountRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(bankAccountController.update));
