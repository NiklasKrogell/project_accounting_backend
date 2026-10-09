import { Router } from 'express';
import { companySettingsController } from '../controllers/company-settings.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Everyone in the company can read its settings, since they decide what the
// UI lets them enter; changing them is for ACCOUNTANT and up.
export const companySettingsRoutes = Router();

companySettingsRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(companySettingsController.get));
companySettingsRoutes.patch(
  '/',
  roleAtLeast('ACCOUNTANT'),
  asyncHandler(companySettingsController.update),
);
