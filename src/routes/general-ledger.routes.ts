import { Router } from 'express';
import { generalLedgerController } from '../controllers/general-ledger.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Read-only report; anyone with access to the company may read it.
export const generalLedgerRoutes = Router();

generalLedgerRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(generalLedgerController.list));
