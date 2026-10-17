-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('NEW', 'APPROVED', 'PAID', 'REJECTED');

-- AlterTable
ALTER TABLE "ChartOfAccounts" ADD COLUMN     "tradePayablesAccountId" TEXT;

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "purchaseInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessId" TEXT,
    "vatNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "streetAddress" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FI',
    "iban" TEXT,
    "bic" TEXT,
    "defaultAccountId" TEXT,
    "defaultVatRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "paymentReference" TEXT,
    "invoiceDate" DATE NOT NULL,
    "entryDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "iban" TEXT,
    "bic" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "vatBasis" TEXT NOT NULL DEFAULT 'net',
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'NEW',
    "journalEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL,
    "vatAmount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "costCenterId" TEXT,

    CONSTRAINT "PurchaseInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_companyId_name_idx" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_businessId_key" ON "Supplier"("companyId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_journalEntryId_key" ON "PurchaseInvoice"("journalEntryId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_companyId_status_dueDate_idx" ON "PurchaseInvoice"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_supplierId_idx" ON "PurchaseInvoice"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_companyId_supplierId_invoiceNumber_key" ON "PurchaseInvoice"("companyId", "supplierId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_purchaseInvoiceId_position_idx" ON "PurchaseInvoiceLine"("purchaseInvoiceId", "position");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_accountId_idx" ON "PurchaseInvoiceLine"("accountId");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_costCenterId_idx" ON "PurchaseInvoiceLine"("costCenterId");

-- CreateIndex
CREATE INDEX "StoredFile_purchaseInvoiceId_idx" ON "StoredFile"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "ChartOfAccounts" ADD CONSTRAINT "ChartOfAccounts_tradePayablesAccountId_fkey" FOREIGN KEY ("tradePayablesAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows are entered net or gross; nothing else (see src/lib/vat.ts).
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_vat_basis"
    CHECK ("vatBasis" IN ('net', 'gross'));

-- An invoice has its purchase entry exactly while it is approved or paid
-- (see src/services/purchase-invoice.service.ts).
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_entry_matches_status"
    CHECK (("journalEntryId" IS NOT NULL) = ("status" IN ('APPROVED', 'PAID')));

-- Existing companies on the default chart get its trade payables account,
-- 2700 Ostovelat, as new ones do in chartOfAccountsService.initializeDefault.
-- Only where 2700 is still in a group classified as trade payables, so a
-- company that has made the number into something else is left to choose.
UPDATE "ChartOfAccounts" c
SET "tradePayablesAccountId" = a."id"
FROM "Account" a
JOIN "AccountGroup" g ON g."id" = a."accountGroupId"
WHERE a."companyId" = c."companyId"
  AND a."number" = '2700'
  AND g."balanceSheetItem" = 'SHORT_TERM_TRADE_PAYABLES'
  AND c."tradePayablesAccountId" IS NULL;
