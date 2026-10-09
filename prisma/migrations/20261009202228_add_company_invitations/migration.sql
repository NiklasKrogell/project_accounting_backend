-- CreateTable
CREATE TABLE "CompanyInvitation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyInvitation_companyId_idx" ON "CompanyInvitation"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvitation_userId_companyId_key" ON "CompanyInvitation"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvitation" ADD CONSTRAINT "CompanyInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
