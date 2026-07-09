-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PeriodGranularity" AS ENUM ('MONTH', 'QUARTER');

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "granularity" "PeriodGranularity" NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalYear_companyId_startDate_endDate_idx" ON "FiscalYear"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_startDate_key" ON "FiscalYear"("companyId", "startDate");

-- CreateIndex
CREATE INDEX "AccountingPeriod_companyId_startDate_endDate_idx" ON "AccountingPeriod"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_fiscalYearId_index_key" ON "AccountingPeriod"("fiscalYearId", "index");

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DB-level backstop for the app-level overlap check (fiscal-year.service.ts):
-- fiscal years of the same company must never overlap, even if a future code
-- path writes rows without going through the service.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "FiscalYear"
  ADD CONSTRAINT "FiscalYear_no_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );
