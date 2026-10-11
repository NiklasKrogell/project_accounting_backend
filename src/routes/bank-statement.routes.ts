import { Router } from 'express';
import { bankStatementController } from '../controllers/bank-statement.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { uploadSingleFile } from '../middleware/uploadSingleFile';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// VIEWER and above read the company's bank statements, LEDGER and above import
// them, choose their bank account and mark them posted — the same split as for
// the journal entries booked from them. The role gate comes before the upload
// is read, as for the files.
export const bankStatementRoutes = Router();

bankStatementRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(bankStatementController.list));
bankStatementRoutes.post(
  '/',
  roleAtLeast('LEDGER'),
  uploadSingleFile,
  asyncHandler(bankStatementController.import),
);
bankStatementRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(bankStatementController.get));
bankStatementRoutes.get(
  '/:id/summary',
  roleAtLeast('VIEWER'),
  asyncHandler(bankStatementController.summary),
);
bankStatementRoutes.patch(
  '/:id',
  roleAtLeast('LEDGER'),
  asyncHandler(bankStatementController.update),
);
