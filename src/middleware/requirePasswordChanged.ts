import type { NextFunction, Request, Response } from 'express';

// Gate: an account created with a temporary password (User.mustChangePassword)
// is answered by nothing but /api/auth until its user has set a password of
// their own (POST /api/auth/change-password). Must run after requireAuth.
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.user.mustChangePassword) {
    res.status(403).json({ error: { message: 'Password change required' } });
    return;
  }
  next();
}
