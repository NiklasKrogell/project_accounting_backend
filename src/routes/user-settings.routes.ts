import { Router } from 'express';
import { userSettingsController } from '../controllers/user-settings.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePasswordChanged } from '../middleware/requirePasswordChanged';
import { asyncHandler } from '../lib/asyncHandler';

// Auth-only, NOT subscription-gated: personal preferences follow the user and
// must not depend on whether the currently active company has paid.
export const userSettingsRoutes = Router();

userSettingsRoutes.use(requireAuth, requirePasswordChanged);
userSettingsRoutes.get('/', asyncHandler(userSettingsController.get));
userSettingsRoutes.patch('/', asyncHandler(userSettingsController.update));
