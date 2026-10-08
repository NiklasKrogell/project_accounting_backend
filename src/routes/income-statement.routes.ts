import { Router } from 'express';
import { incomeStatementController } from '../controllers/income-statement.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Read-only report; anyone with access to the company may read it.
export const incomeStatementRoutes = Router();

incomeStatementRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(incomeStatementController.get));
