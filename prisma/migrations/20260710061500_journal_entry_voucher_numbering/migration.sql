-- voucherNumber becomes an auto-allocated integer within a per-company,
-- per-voucher-type series (see VoucherCounter). The JournalEntry table is
-- empty at this point, so the drop+add column change loses no data.

-- AlterTable
ALTER TABLE "JournalEntry" DROP COLUMN "voucherNumber",
ADD COLUMN     "voucherNumber" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "VoucherCounter" (
    "companyId" TEXT NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VoucherCounter_pkey" PRIMARY KEY ("companyId","voucherType")
);

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_date_idx" ON "JournalEntry"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_voucherType_voucherNumber_key" ON "JournalEntry"("companyId", "voucherType", "voucherNumber");

-- AddForeignKey
ALTER TABLE "VoucherCounter" ADD CONSTRAINT "VoucherCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
