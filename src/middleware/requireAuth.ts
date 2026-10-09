import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { findSessionByToken, SESSION_COOKIE } from '../lib/session';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';

// Authenticates the request from the session cookie and attaches req.auth.
// Also enforces a CSRF posture on state-changing requests: when a browser sends
// an Origin header it must match the configured UI origin (non-browser clients
// like curl send no Origin and pass through).
export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && origin !== env.CORS_ORIGIN) {
      res.status(403).json({ error: { message: 'Origin not allowed' } });
      return;
    }
  }

  const token = (req.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: { message: 'Authentication required' } });
    return;
  }

  const session = await findSessionByToken(token);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required' } });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    res.status(401).json({ error: { message: 'Authentication required' } });
    return;
  }

  // Re-verify membership of the active company on every request so a user
  // removed from a company loses access immediately, even mid-session.
  let membership = null;
  if (session.activeCompanyId) {
    membership = await prisma.companyUser.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: session.activeCompanyId } },
      include: { company: true },
    });
    if (!membership) {
      await prisma.session.update({
        where: { id: session.id },
        data: { activeCompanyId: null },
      });
      // Keep this request's copy in step, so /api/auth/me doesn't report a
      // company the user is no longer in.
      session.activeCompanyId = null;
    }
  }

  req.auth = { user, session, membership };
  next();
});
