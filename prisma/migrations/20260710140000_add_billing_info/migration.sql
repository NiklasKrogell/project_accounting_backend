-- Add billing information fields to Company
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "businessId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "billingEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "billingAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "billingCity" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "billingPostalCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "billingCountry" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Company_businessId_key" ON "Company"("businessId");
