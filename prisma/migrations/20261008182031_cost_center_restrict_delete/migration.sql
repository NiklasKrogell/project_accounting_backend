-- DropForeignKey
ALTER TABLE "JournalEntryLine" DROP CONSTRAINT "JournalEntryLine_costCenterId_fkey";

-- AddForeignKey
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
