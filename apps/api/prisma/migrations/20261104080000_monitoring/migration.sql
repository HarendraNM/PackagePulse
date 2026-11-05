ALTER TABLE "TrackedPackage"
  ADD COLUMN "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "lastError" VARCHAR(500);

CREATE INDEX "TrackedPackage_monitoringEnabled_lastCheckedAt_idx"
  ON "TrackedPackage"("monitoringEnabled", "lastCheckedAt");
