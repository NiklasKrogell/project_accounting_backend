import { Router } from 'express';
import { purchaseInvoiceController } from '../controllers/purchase-invoice.controller';
import { roleAtLeast } from '../middleware/requireRole';
import { uploadSingleFile, uploadSingleFileWithJson } from '../middleware/uploadSingleFile';
import { asyncHandler } from '../lib/asyncHandler';

// Mounted on the gated router (requireAuth + requireActiveSubscription).
// VIEWER and above read the company's purchase invoices; LEDGER and above
// enter, change and delete them and move them between statuses, approving
// (booking) included. Whether an approval may be booked on its entry date is
// up to the fiscal guards. The role gate comes before the upload is read, as
// for the files. A new invoice may come with its PDF, as multipart (see the
// controller's create); a JSON body goes past the parser untouched.
export const purchaseInvoiceRoutes = Router();

purchaseInvoiceRoutes.get('/', roleAtLeast('VIEWER'), asyncHandler(purchaseInvoiceController.list));
purchaseInvoiceRoutes.post(
  '/',
  roleAtLeast('LEDGER'),
  uploadSingleFileWithJson,
  asyncHandler(purchaseInvoiceController.create),
);
purchaseInvoiceRoutes.get('/:id', roleAtLeast('VIEWER'), asyncHandler(purchaseInvoiceController.get));
purchaseInvoiceRoutes.put('/:id', roleAtLeast('LEDGER'), asyncHandler(purchaseInvoiceController.update));
purchaseInvoiceRoutes.delete(
  '/:id',
  roleAtLeast('LEDGER'),
  asyncHandler(purchaseInvoiceController.remove),
);
purchaseInvoiceRoutes.post(
  '/:id/status',
  roleAtLeast('LEDGER'),
  asyncHandler(purchaseInvoiceController.setStatus),
);
purchaseInvoiceRoutes.post(
  '/:id/files',
  roleAtLeast('LEDGER'),
  uploadSingleFile,
  asyncHandler(purchaseInvoiceController.attachFile),
);
