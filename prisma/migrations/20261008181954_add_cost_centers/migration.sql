-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "businessId" DROP DEFAULT,
ALTER COLUMN "billingEmail" DROP DEFAULT,
ALTER COLUMN "billingAddress" DROP DEFAULT,
ALTER COLUMN "billingCity" DROP DEFAULT,
ALTER COLUMN "billingPostalCode" DROP DEFAULT,
ALTER COLUMN "billingCountry" DROP DEFAULT;

-- AlterTable
ALTER TABLE "JournalEntryLine" ADD COLUMN     "costCenterId" TEXT;

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostCenter_companyId_idx" ON "CostCenter"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_companyId_code_key" ON "CostCenter"("companyId", "code");

-- CreateIndex
CREATE INDEX "JournalEntryLine_costCenterId_idx" ON "JournalEntryLine"("costCenterId");

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
