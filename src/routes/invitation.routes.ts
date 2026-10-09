import { Router } from 'express';
import { invitationController } from '../controllers/invitation.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePasswordChanged } from '../middleware/requirePasswordChanged';
import { asyncHandler } from '../lib/asyncHandler';

// Auth-only, NOT subscription-gated: the inbox belongs to the user, and the
// one most likely to be waiting for an invitation has no company at all yet.
export const invitationRoutes = Router();

invitationRoutes.use(requireAuth, requirePasswordChanged);
invitationRoutes.get('/', asyncHandler(invitationController.list));
invitationRoutes.post('/:id/accept', asyncHandler(invitationController.accept));
invitationRoutes.post('/:id/decline', asyncHandler(invitationController.decline));
