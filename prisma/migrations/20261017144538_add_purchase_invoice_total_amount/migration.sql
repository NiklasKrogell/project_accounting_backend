-- The invoice's total including VAT, as typed from the invoice. The rows must
-- come to it before the invoice can be approved.
ALTER TABLE "PurchaseInvoice" ADD COLUMN "totalAmount" DOUBLE PRECISION;

-- Backfill: an invoice already there is taken to total what its rows come to,
-- summed in cents as invoiceTotals (src/lib/purchaseInvoice.ts) does.
UPDATE "PurchaseInvoice" AS i
SET "totalAmount" = COALESCE(
  (
    SELECT SUM(ROUND(l."amount" * 100) + ROUND(l."vatAmount" * 100)) / 100.0
    FROM "PurchaseInvoiceLine" AS l
    WHERE l."purchaseInvoiceId" = i."id"
  ),
  0
);

ALTER TABLE "PurchaseInvoice" ALTER COLUMN "totalAmount" SET NOT NULL;
