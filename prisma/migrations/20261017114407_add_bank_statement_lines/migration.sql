-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankStatementId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "bookingDate" DATE NOT NULL,
    "valueDate" DATE,
    "amount" DOUBLE PRECISION NOT NULL,
    "counterparty" TEXT NOT NULL DEFAULT '',
    "counterpartyAccount" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "transactionType" TEXT NOT NULL DEFAULT '',
    "archiveId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_journalEntryId_key" ON "BankStatementLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "BankStatementLine_bankStatementId_position_idx" ON "BankStatementLine"("bankStatementId", "position");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_dedupeKey_idx" ON "BankStatementLine"("companyId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_bankStatementId_fkey" FOREIGN KEY ("bankStatementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
