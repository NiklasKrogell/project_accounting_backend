import { Router } from 'express';
import type { Request, Response } from 'express';
import { healthRoutes } from './health.routes';
import { authRoutes } from './auth.routes';
import { companyRoutes } from './company.routes';
import { userSettingsRoutes } from './user-settings.routes';
import { companySettingsRoutes } from './company-settings.routes';
import { companyInfoRoutes } from './company-info.routes';
import { companyUserRoutes } from './company-user.routes';
import { companyInvitationRoutes } from './company-invitation.routes';
import { invitationRoutes } from './invitation.routes';
import { fiscalYearRoutes } from './fiscal-year.routes';
import { accountingPeriodRoutes } from './accounting-period.routes';
import { journalEntryRoutes } from './journal-entry.routes';
import { accountGroupRoutes } from './account-group.routes';
import { accountRoutes } from './account.routes';
import { bankAccountRoutes } from './bank-account.routes';
import { costCenterRoutes } from './cost-center.routes';
import { chartOfAccountsRoutes } from './chart-of-accounts.routes';
import { generalLedgerRoutes } from './general-ledger.routes';
import { incomeStatementRoutes } from './income-statement.routes';
import { balanceSheetRoutes } from './balance-sheet.routes';
import { storedFileRoutes } from './stored-file.routes';
import { requireAuth } from '../middleware/requireAuth';
import { requirePasswordChanged } from '../middleware/requirePasswordChanged';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription';

export const routes = Router();

// Public
routes.use('/health', healthRoutes);

// Auth & account management (own gating rules inside)
routes.use('/api/auth', authRoutes);
routes.use('/api/companies', companyRoutes);
// Personal settings follow the user across companies, so they sit outside the
// paywall. Company settings are company data and mount on the gated router.
routes.use('/api/settings/user', userSettingsRoutes);
// So is the user's inbox: invitations reach a user who has no company yet.
routes.use('/api/invitations', invitationRoutes);

// --- Everything below is the paywalled application area. ---
// All future accounting data routes mount behind this same gate and must scope
// every query by req.auth.membership.companyId.
const gated = Router();
gated.use(requireAuth, requirePasswordChanged, requireActiveSubscription);

// Stand-in endpoint proving the gate works until real domain routes exist.
gated.get('/ping', (req: Request, res: Response) => {
  const membership = req.auth!.membership!;
  res.json({
    data: { ok: true, companyId: membership.companyId, role: membership.role },
  });
});

gated.use('/settings/company/info', companyInfoRoutes);
gated.use('/settings/company/users', companyUserRoutes);
gated.use('/settings/company/invitations', companyInvitationRoutes);
gated.use('/settings/company', companySettingsRoutes);
gated.use('/fiscal-years', fiscalYearRoutes);
gated.use('/accounting-periods', accountingPeriodRoutes);
gated.use('/journal-entries', journalEntryRoutes);
gated.use('/general-ledger', generalLedgerRoutes);
gated.use('/income-statement', incomeStatementRoutes);
gated.use('/balance-sheet', balanceSheetRoutes);
gated.use('/chart-of-accounts', chartOfAccountsRoutes);
gated.use('/account-groups', accountGroupRoutes);
gated.use('/accounts', accountRoutes);
gated.use('/bank-accounts', bankAccountRoutes);
gated.use('/cost-centers', costCenterRoutes);
gated.use('/files', storedFileRoutes);

routes.use('/api', gated);
