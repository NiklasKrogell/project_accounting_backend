-- Chart of accounts cleanup:
-- - Account/BankAccount no longer store a balance (balances are derived from
--   journal entry lines).
-- - Account numbers are unique per company, not globally.
-- - BankAccount IBAN is unique per company.
-- These tables are empty at this point, so dropping columns and adding the
-- NOT NULL updatedAt column loses no data.

-- DropIndex
DROP INDEX "Account_number_key";

-- DropIndex
DROP INDEX "BankAccount_companyId_iban_accountId_key";

-- DropIndex
DROP INDEX "BankAccount_iban_key";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "balance",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "BankAccount" DROP COLUMN "balance";

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_number_key" ON "Account"("companyId", "number");

-- CreateIndex
CREATE INDEX "BankAccount_companyId_idx" ON "BankAccount"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_companyId_iban_key" ON "BankAccount"("companyId", "iban");
