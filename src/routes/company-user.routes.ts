import { Router } from 'express';
import { companyUserController } from '../controllers/company-user.controller';
import { requireCompanyAdmin, roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Everyone in the company can see who its members are. Giving and taking away
// access is for its company administrators (isAdmin). Changing a role has
// rules that depend on both members involved (src/lib/roles.ts), so the
// service applies them rather than a guard here.
export const companyUserRoutes = Router();

companyUserRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(companyUserController.list));
companyUserRoutes.post('/', requireCompanyAdmin, asyncHandler(companyUserController.create));
companyUserRoutes.patch('/:userId', asyncHandler(companyUserController.update));
companyUserRoutes.delete('/:userId', requireCompanyAdmin, asyncHandler(companyUserController.remove));
companyUserRoutes.post(
  '/:userId/temporary-password',
  requireCompanyAdmin,
  asyncHandler(companyUserController.resetTemporaryPassword),
);
