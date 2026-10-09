import { Router } from 'express';
import { companyInvitationController } from '../controllers/company-invitation.controller';
import { requireCompanyAdmin, roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// Everyone in the company can see who has been invited, as they can see its
// members. Cancelling an invitation is, like sending one, for its company
// administrators (isAdmin).
export const companyInvitationRoutes = Router();

companyInvitationRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(companyInvitationController.list));
companyInvitationRoutes.delete(
  '/:id',
  requireCompanyAdmin,
  asyncHandler(companyInvitationController.cancel),
);
