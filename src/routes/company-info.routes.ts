import { Router } from 'express';
import { companyInfoController } from '../controllers/company-info.controller';
import { requireCompanyAdmin, roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Everyone in the company can read its details; changing them is for its
// company administrators (isAdmin), whatever their accounting role.
export const companyInfoRoutes = Router();

companyInfoRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(companyInfoController.get));
companyInfoRoutes.patch('/', requireCompanyAdmin, asyncHandler(companyInfoController.update));
