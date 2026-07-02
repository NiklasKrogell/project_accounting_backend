import type { NextFunction, Request, Response } from 'express';

// Gate: the session's active company must have an ACTIVE, unexpired
// subscription. When a company's payment lapses, every request from its users
// hits this and gets 402 — company-wide lockout. Must run after requireAuth.
export function requireActiveSubscription(req: Request, res: Response, next: NextFunction): void {
  const membership = req.auth?.membership;

  if (!membership) {
    res.status(403).json({ error: { message: 'No active company selected' } });
    return;
  }

  const { company } = membership;
  const lapsed =
    company.subscriptionStatus !== 'ACTIVE' ||
    (company.subscriptionEndsAt !== null && company.subscriptionEndsAt.getTime() <= Date.now());

  if (lapsed) {
    res.status(402).json({
      error: {
        message: 'An active subscription is required for this company',
        subscriptionStatus: company.subscriptionStatus,
        companyId: company.id,
      },
    });
    return;
  }

  next();
}
