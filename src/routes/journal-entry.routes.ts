import { Router } from 'express';
import { journalEntryController } from '../controllers/journal-entry.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// LEDGER and above manage entries; whether an entry may be written or changed
// on a given date is enforced by the fiscal guards in the service layer.
export const journalEntryRoutes = Router();

journalEntryRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(journalEntryController.list));
journalEntryRoutes.post('/', roleAtLeast('LEDGER'), asyncHandler(journalEntryController.create));
journalEntryRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(journalEntryController.get));
journalEntryRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(journalEntryController.update));
journalEntryRoutes.delete('/:id', roleAtLeast('LEDGER'), asyncHandler(journalEntryController.remove));
