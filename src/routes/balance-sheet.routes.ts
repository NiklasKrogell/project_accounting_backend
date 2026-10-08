import { Router } from 'express';
import { balanceSheetController } from '../controllers/balance-sheet.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Read-only report; anyone with access to the company may read it.
export const balanceSheetRoutes = Router();

balanceSheetRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(balanceSheetController.get));
