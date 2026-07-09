import { Router } from 'express';
import type { Request, Response } from 'express';
import { healthRoutes } from './health.routes';
import { authRoutes } from './auth.routes';
import { companyRoutes } from './company.routes';
import { fiscalYearRoutes } from './fiscal-year.routes';
import { accountingPeriodRoutes } from './accounting-period.routes';
import { journalEntryRoutes } from './journal-entry.routes';
import { requireAuth } from '../middleware/requireAuth';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription';

export const routes = Router();

// Public
routes.use('/health', healthRoutes);

// Auth & account management (own gating rules inside)
routes.use('/api/auth', authRoutes);
routes.use('/api/companies', companyRoutes);

// --- Everything below is the paywalled application area. ---
// All future accounting data routes mount behind this same gate and must scope
// every query by req.auth.membership.companyId.
const gated = Router();
gated.use(requireAuth, requireActiveSubscription);

// Stand-in endpoint proving the gate works until real domain routes exist.
gated.get('/ping', (req: Request, res: Response) => {
  const membership = req.auth!.membership!;
  res.json({
    data: { ok: true, companyId: membership.companyId, role: membership.role },
  });
});

gated.use('/fiscal-years', fiscalYearRoutes);
gated.use('/accounting-periods', accountingPeriodRoutes);
gated.use('/journal-entries', journalEntryRoutes);

routes.use('/api', gated);
