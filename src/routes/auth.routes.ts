import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/requireAuth';
import {
  loginLimiter,
  passwordChangeLimiter,
  signupLimiter,
  tokenLimiter,
} from '../middleware/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';

export const authRoutes = Router();

// Public (rate-limited)
authRoutes.post('/signup', signupLimiter, asyncHandler(authController.signup));
authRoutes.post('/login', loginLimiter, asyncHandler(authController.login));
authRoutes.post('/verify-email', tokenLimiter, asyncHandler(authController.verifyEmail));
authRoutes.post('/forgot-password', tokenLimiter, asyncHandler(authController.forgotPassword));
authRoutes.post('/reset-password', tokenLimiter, asyncHandler(authController.resetPassword));

// Authenticated — deliberately NOT subscription-gated: users must always be able
// to see their state, switch companies, and log out, even when payment lapsed.
// Not behind requirePasswordChanged either: these are all a user with a
// temporary password can reach, change-password being the way out.
authRoutes.post(
  '/change-password',
  passwordChangeLimiter,
  requireAuth,
  asyncHandler(authController.changePassword),
);
authRoutes.post('/logout', requireAuth, asyncHandler(authController.logout));
authRoutes.post('/logout-all', requireAuth, asyncHandler(authController.logoutAll));
authRoutes.get('/me', requireAuth, asyncHandler(authController.me));
authRoutes.post('/switch-company', requireAuth, asyncHandler(authController.switchCompany));
