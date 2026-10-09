import type { Request, Response } from 'express';
import { z } from 'zod';
import { authService, sanitizeUser } from '../services/auth.service';
import { passwordSchema } from '../lib/apiSchemas';
import {
  clearSessionCookie,
  deleteAllSessionsForUser,
  deleteSession,
  setSessionCookie,
} from '../lib/session';

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: passwordSchema,
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const switchCompanySchema = z.object({ companyId: z.string().uuid() });
const verifyEmailSchema = z.object({ token: z.string().min(1) });
const forgotPasswordSchema = z.object({ email: z.string().trim().email() });
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

// req.auth is always present in handlers mounted behind requireAuth.
function auth(req: Request) {
  return req.auth!;
}

export const authController = {
  async signup(req: Request, res: Response) {
    const input = signupSchema.parse(req.body);
    const { user, sessionToken } = await authService.signup(input);
    setSessionCookie(res, sessionToken);
    res.status(201).json({ data: { user: sanitizeUser(user) } });
  },

  async login(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    const { user, sessionToken } = await authService.login(email, password);
    setSessionCookie(res, sessionToken);
    res.json({ data: { user: sanitizeUser(user) } });
  },

  async logout(req: Request, res: Response) {
    await deleteSession(auth(req).session.id);
    clearSessionCookie(res);
    res.json({ data: { loggedOut: true } });
  },

  async logoutAll(req: Request, res: Response) {
    await deleteAllSessionsForUser(auth(req).user.id);
    clearSessionCookie(res);
    res.json({ data: { loggedOut: true } });
  },

  async me(req: Request, res: Response) {
    const { user, session } = auth(req);
    const data = await authService.me(user.id, session.activeCompanyId);
    res.json({ data });
  },

  async switchCompany(req: Request, res: Response) {
    const { companyId } = switchCompanySchema.parse(req.body);
    const { user, session } = auth(req);
    const membership = await authService.switchCompany(user.id, session.id, companyId);
    res.json({
      data: {
        activeCompanyId: membership.companyId,
        companyName: membership.company.name,
        role: membership.role,
        isAdmin: membership.isAdmin,
        subscriptionStatus: membership.company.subscriptionStatus,
      },
    });
  },

  async verifyEmail(req: Request, res: Response) {
    const { token } = verifyEmailSchema.parse(req.body);
    await authService.verifyEmail(token);
    res.json({ data: { verified: true } });
  },

  async forgotPassword(req: Request, res: Response) {
    const { email } = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(email);
    // Same response whether or not the account exists.
    res.json({ data: { sent: true } });
  },

  async resetPassword(req: Request, res: Response) {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ data: { reset: true } });
  },

  async changePassword(req: Request, res: Response) {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const { user, session } = auth(req);
    await authService.changePassword(user.id, session.id, currentPassword, newPassword);
    res.json({ data: { changed: true } });
  },
};
