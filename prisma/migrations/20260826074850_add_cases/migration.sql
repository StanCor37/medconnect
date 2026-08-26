-- CreateEnum
CREATE TYPE "CaseMode" AS ENUM ('standalone', 'client_connected');

-- CreateEnum
CREATE TYPE "CaseSource" AS ENUM ('ui', 'api');

-- CreateEnum
CREATE TYPE "ExternalReferenceSource" AS ENUM ('client', 'insurer', 'provider', 'partner_api', 'manual');

-- CreateEnum
CREATE TYPE "ProviderCaseAccess" AS ENUM ('creator_only', 'provider_shared');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('draft', 'documents_in_progress', 'ready_for_validation', 'validating', 'provider_action_required', 'client_review_required', 'validated', 'validated_with_issues', 'submitted_to_client', 'returned_to_provider', 'accepted', 'rejected', 'liquidated', 'closed', 'cancelled', 'archived');

-- CreateTable
CREATE TABLE "Insurer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insurer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaseSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "internalReference" TEXT NOT NULL,
    "caseMode" "CaseMode" NOT NULL DEFAULT 'standalone',
    "source" "CaseSource" NOT NULL DEFAULT 'ui',
    "status" "CaseStatus" NOT NULL DEFAULT 'draft',
    "providerId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "providerCaseAccess" "ProviderCaseAccess" NOT NULL DEFAULT 'provider_shared',
    "insurerId" TEXT,
    "clientId" TEXT,
    "providerClientRelationshipId" TEXT,
    "validationSchemeVersionId" TEXT,
    "externalReference" TEXT,
    "externalReferenceSource" "ExternalReferenceSource",
    "patientReference" TEXT,
    "serviceType" TEXT,
    "eventDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Insurer_name_country_key" ON "Insurer"("name", "country");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_providerId_key_key" ON "IdempotencyKey"("providerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Case_internalReference_key" ON "Case"("internalReference");

-- CreateIndex
CREATE INDEX "Case_providerId_idx" ON "Case"("providerId");

-- CreateIndex
CREATE INDEX "Case_clientId_idx" ON "Case"("clientId");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "Case_createdByUserId_idx" ON "Case"("createdByUserId");

-- CreateIndex
CREATE INDEX "Case_assignedToUserId_idx" ON "Case"("assignedToUserId");

-- CreateIndex
CREATE INDEX "Case_insurerId_idx" ON "Case"("insurerId");

-- CreateIndex
CREATE UNIQUE INDEX "Case_providerId_clientId_externalReferenceSource_externalRe_key" ON "Case"("providerId", "clientId", "externalReferenceSource", "externalReference");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_providerClientRelationshipId_fkey" FOREIGN KEY ("providerClientRelationshipId") REFERENCES "ProviderClientRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS policies for Segment 4 (see prisma/rls.sql for the maintained source of truth)

-- Fix a leak introduced by AuditEvent.caseId's new ON DELETE SET NULL: a
-- hard-deleted Case's own audit rows would have caseId nulled and start
-- satisfying the old "caseId IS NULL" condition alone.
DROP POLICY audit_select_super_admin ON "AuditEvent";
CREATE POLICY audit_select_super_admin ON "AuditEvent" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND "caseId" IS NULL
    AND "targetType" != 'Case'
  );

ALTER TABLE "Case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Insurer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;

-- Case: Super Admin gets NO policy at all — literal zero visibility, not
-- even the standalone-only carve-out every other table gives it. Do not add
-- a super_admin policy here, ever.

CREATE POLICY case_select_provider_user ON "Case" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "providerId" = NULLIF(current_setting('app.provider_id', true), '')
    AND (
      "providerCaseAccess" = 'provider_shared'
      OR ("providerCaseAccess" = 'creator_only' AND "createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
    )
  );
CREATE POLICY case_modify_provider_user ON "Case" FOR ALL
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "providerId" = NULLIF(current_setting('app.provider_id', true), '')
    AND (
      "providerCaseAccess" = 'provider_shared'
      OR ("providerCaseAccess" = 'creator_only' AND "createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
    )
  )
  WITH CHECK ("providerId" = NULLIF(current_setting('app.provider_id', true), ''));

CREATE POLICY case_select_client_admin ON "Case" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r.id = "Case"."providerClientRelationshipId" AND r.status = 'active'
    )
  );

CREATE POLICY insurer_select_any ON "Insurer" FOR SELECT USING (true);

CREATE POLICY idempotency_key_all_own_provider ON "IdempotencyKey" FOR ALL
  USING ("providerId" = NULLIF(current_setting('app.provider_id', true), ''))
  WITH CHECK ("providerId" = NULLIF(current_setting('app.provider_id', true), ''));
