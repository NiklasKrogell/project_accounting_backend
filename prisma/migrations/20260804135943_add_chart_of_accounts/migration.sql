-- ChartOfAccounts: each company has exactly one chart of accounts, which owns
-- its account groups and accounts. Existing companies are backfilled with a
-- chart, and their existing AccountGroup/Account rows are linked to it,
-- before the new columns are made required.

-- CreateTable
CREATE TABLE "ChartOfAccounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartOfAccounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccounts_companyId_key" ON "ChartOfAccounts"("companyId");

-- AddForeignKey
ALTER TABLE "ChartOfAccounts" ADD CONSTRAINT "ChartOfAccounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one chart per existing company.
INSERT INTO "ChartOfAccounts" ("id", "companyId", "updatedAt")
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP FROM "Company";

-- AlterTable: add nullable first so existing rows can be backfilled below.
ALTER TABLE "Account" ADD COLUMN "chartOfAccountsId" TEXT;
ALTER TABLE "AccountGroup" ADD COLUMN "chartOfAccountsId" TEXT;

-- Backfill existing accounts/groups from their company's (new) chart.
UPDATE "Account" a
SET "chartOfAccountsId" = c."id"
FROM "ChartOfAccounts" c
WHERE c."companyId" = a."companyId";

UPDATE "AccountGroup" g
SET "chartOfAccountsId" = c."id"
FROM "ChartOfAccounts" c
WHERE c."companyId" = g."companyId";

-- Now that every row has a value, enforce NOT NULL.
ALTER TABLE "Account" ALTER COLUMN "chartOfAccountsId" SET NOT NULL;
ALTER TABLE "AccountGroup" ALTER COLUMN "chartOfAccountsId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Account_chartOfAccountsId_idx" ON "Account"("chartOfAccountsId");

-- CreateIndex
CREATE INDEX "AccountGroup_chartOfAccountsId_idx" ON "AccountGroup"("chartOfAccountsId");

-- AddForeignKey
ALTER TABLE "AccountGroup" ADD CONSTRAINT "AccountGroup_chartOfAccountsId_fkey" FOREIGN KEY ("chartOfAccountsId") REFERENCES "ChartOfAccounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_chartOfAccountsId_fkey" FOREIGN KEY ("chartOfAccountsId") REFERENCES "ChartOfAccounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
