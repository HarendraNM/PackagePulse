CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TrackedPackage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packageName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackedPackage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PackageSnapshot" (
  "id" TEXT NOT NULL,
  "packageName" TEXT NOT NULL,
  "version" TEXT,
  "healthScore" INTEGER,
  "securitySummary" JSONB,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "TrackedPackage_userId_packageName_key" ON "TrackedPackage"("userId", "packageName");
CREATE INDEX "TrackedPackage_userId_createdAt_idx" ON "TrackedPackage"("userId", "createdAt");
CREATE INDEX "PackageSnapshot_packageName_collectedAt_idx" ON "PackageSnapshot"("packageName", "collectedAt");
ALTER TABLE "TrackedPackage" ADD CONSTRAINT "TrackedPackage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
