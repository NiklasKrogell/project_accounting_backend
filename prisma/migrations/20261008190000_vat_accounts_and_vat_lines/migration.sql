-- Automatic VAT rows: a journal entry line with a VAT rate now gets a
-- generated row on the company's VAT account (see src/lib/vat.ts).
--
-- ChartOfAccounts names the two accounts those rows post to, and
-- JournalEntryLine.isVat marks the generated rows.

-- AlterTable
ALTER TABLE "ChartOfAccounts" ADD COLUMN "vatReceivableAccountId" TEXT,
ADD COLUMN "vatPayableAccountId" TEXT;

-- AlterTable
ALTER TABLE "JournalEntryLine" ADD COLUMN "isVat" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "ChartOfAccounts" ADD CONSTRAINT "ChartOfAccounts_vatReceivableAccountId_fkey" FOREIGN KEY ("vatReceivableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartOfAccounts" ADD CONSTRAINT "ChartOfAccounts_vatPayableAccountId_fkey" FOREIGN KEY ("vatPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: charts seeded from the default chart of accounts
-- (src/lib/defaultChartOfAccounts.ts) get its VAT accounts, 1763
-- Arvonlisäverosaaminen and 2939 Arvonlisäverovelka. Matched by number only,
-- so a company that renamed them still gets them; a company without those
-- numbers keeps NULL and picks its VAT accounts in the chart of accounts.
--
-- Existing lines are NOT given VAT rows: entries saved before this migration
-- balance without them, so adding rows would unbalance the books.
UPDATE "ChartOfAccounts" c
SET "vatReceivableAccountId" = a."id"
FROM "Account" a
WHERE a."chartOfAccountsId" = c."id" AND a."number" = '1763';

UPDATE "ChartOfAccounts" c
SET "vatPayableAccountId" = a."id"
FROM "Account" a
WHERE a."chartOfAccountsId" = c."id" AND a."number" = '2939';
