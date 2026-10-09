import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../generated/prisma/client';
import { roleRank } from '../lib/roles';

// Requires the caller's role in the active company to be at least `minRole`.
// Must run after requireAuth (and typically requireActiveSubscription).
export function roleAtLeast(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const membership = req.auth?.membership;
    if (!membership) {
      res.status(403).json({ error: { message: 'No active company selected' } });
      return;
    }
    if (roleRank(membership.role) < roleRank(minRole)) {
      res.status(403).json({ error: { message: 'Insufficient role for this action' } });
      return;
    }
    next();
  };
}

// Requires the caller to be a company administrator of the active company
// (employee/billing management), independent of the accounting role.
export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction): void {
  const membership = req.auth?.membership;
  if (!membership) {
    res.status(403).json({ error: { message: 'No active company selected' } });
    return;
  }
  if (!membership.isAdmin) {
    res.status(403).json({ error: { message: 'Company administrator rights required' } });
    return;
  }
  next();
}
