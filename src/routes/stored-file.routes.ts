import { Router } from 'express';
import { storedFileController } from '../controllers/stored-file.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { uploadSingleFile } from '../middleware/uploadSingleFile';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// VIEWER and above read the company's files, LEDGER and above upload, link and
// delete them — the same split as for the journal entries they document.
// The role gate comes before the upload is read, so nobody without the role
// makes the server buffer a file.
export const storedFileRoutes = Router();

storedFileRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(storedFileController.list));
storedFileRoutes.post(
  '/',
  roleAtLeast('LEDGER'),
  uploadSingleFile,
  asyncHandler(storedFileController.upload),
);
storedFileRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(storedFileController.get));
storedFileRoutes.get(
  '/:id/content',
  roleAtLeast('VIEWER'),
  asyncHandler(storedFileController.download),
);
storedFileRoutes.patch('/:id', roleAtLeast('LEDGER'), asyncHandler(storedFileController.update));
storedFileRoutes.delete('/:id', roleAtLeast('LEDGER'), asyncHandler(storedFileController.remove));
