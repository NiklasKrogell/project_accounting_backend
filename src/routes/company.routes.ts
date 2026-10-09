import { Router } from 'express';
import { companyController } from '../controllers/company.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePasswordChanged } from '../middleware/requirePasswordChanged';
import { asyncHandler } from '../lib/asyncHandler';

// Auth-only, NOT subscription-gated: the switcher and "add a company" must work
// even while the currently active company is unpaid.
export const companyRoutes = Router();

companyRoutes.use(requireAuth, requirePasswordChanged);
companyRoutes.get('/', asyncHandler(companyController.listMine));
companyRoutes.post('/', asyncHandler(companyController.create));
