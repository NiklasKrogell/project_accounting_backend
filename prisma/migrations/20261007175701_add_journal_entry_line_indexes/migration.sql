-- Postgres does not create indexes for foreign-key columns automatically, so
-- JournalEntryLine had only its primary key. Both columns are hot:
--   accountId      - general ledger (per-account lines, opening-balance
--                    groupBy, movement-in-range probe)
--   journalEntryId - deleteMany on entry update/remove, journal list fan-out
-- CREATE INDEX adds no constraint and cannot fail on existing rows.

-- CreateIndex
CREATE INDEX "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalEntryLine_journalEntryId_idx" ON "JournalEntryLine"("journalEntryId");
