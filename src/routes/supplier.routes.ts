import { Router } from 'express';
import { supplierController } from '../controllers/supplier.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// VIEWER and above read the company's suppliers, LEDGER and above manage them
// — the same split as for the purchase invoices from them.
export const supplierRoutes = Router();

supplierRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(supplierController.list));
supplierRoutes.post('/', roleAtLeast('LEDGER'), asyncHandler(supplierController.create));
supplierRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(supplierController.get));
supplierRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(supplierController.update));
supplierRoutes.delete('/:id', roleAtLeast('LEDGER'), asyncHandler(supplierController.remove));
