-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'client_admin', 'provider_user');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('invited', 'active', 'suspended', 'deactivated');

-- CreateEnum
CREATE TYPE "ClientCapability" AS ENUM ('assistance_company', 'insurance_company');

-- CreateEnum
CREATE TYPE "ProviderMode" AS ENUM ('standalone', 'client_connected');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('pending', 'active', 'suspended', 'terminated');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'invited',
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "providerId" TEXT,
    "clientId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "capabilities" "ClientCapability"[],
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "mode" "ProviderMode" NOT NULL DEFAULT 'standalone',
    "country" TEXT NOT NULL,
    "officialRegistrationNumber" TEXT,
    "taxId" TEXT,
    "healthcareLicenseNumber" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "createdBySuperAdminId" TEXT,
    "createdByClientAdminId" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderClientRelationship" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderClientRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "tempPasswordHash" TEXT NOT NULL,
    "tempPasswordExpiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "UserRole",
    "providerId" TEXT,
    "clientId" TEXT,
    "relationshipId" TEXT,
    "caseId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_providerId_idx" ON "User"("providerId");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- CreateIndex
CREATE INDEX "Provider_normalizedName_idx" ON "Provider"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_country_officialRegistrationNumber_key" ON "Provider"("country", "officialRegistrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_country_taxId_key" ON "Provider"("country", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderClientRelationship_providerId_clientId_key" ON "ProviderClientRelationship"("providerId", "clientId");

-- CreateIndex
CREATE INDEX "Invitation_userId_idx" ON "Invitation"("userId");

-- CreateIndex
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_providerId_idx" ON "AuditEvent"("providerId");

-- CreateIndex
CREATE INDEX "AuditEvent_clientId_idx" ON "AuditEvent"("clientId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderClientRelationship" ADD CONSTRAINT "ProviderClientRelationship_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderClientRelationship" ADD CONSTRAINT "ProviderClientRelationship_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ProviderClientRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS policies (see prisma/rls.sql for the maintained source of truth)

-- Row-Level Security policies for the MedConnect foundation schema.
--
-- This file is appended to the end of the initial migration's migration.sql
-- (see README "Running the first migration") so schema and policies travel
-- together in one migration history, as decided in the foundation plan.
--
-- IMPORTANT: with the current single owner-level DATABASE_URL (see the "DB
-- role note" in the plan), Postgres table ownership BYPASSES RLS entirely.
-- These policies are written and will be exercised by the direct-pg RLS
-- tests (tests/rls/policy.test.ts) using an explicit non-owner test role,
-- but the app itself does not yet get this protection at runtime. Creating
-- a dedicated non-owner `medconnect_app` role before production is a
-- documented follow-up, not forgotten.

-- ============================================================================
-- Conditional-FK invariant (defense-in-depth alongside the service layer):
--   super_admin   -> providerId IS NULL AND clientId IS NULL
--   client_admin  -> providerId IS NULL AND clientId IS NOT NULL
--   provider_user -> providerId IS NOT NULL AND clientId IS NULL
-- ============================================================================
ALTER TABLE "User" ADD CONSTRAINT user_role_org_invariant CHECK (
  (role = 'super_admin'  AND "providerId" IS NULL     AND "clientId" IS NULL) OR
  (role = 'client_admin' AND "providerId" IS NULL     AND "clientId" IS NOT NULL) OR
  (role = 'provider_user' AND "providerId" IS NOT NULL AND "clientId" IS NULL)
);

-- ============================================================================
-- Enable RLS
-- ============================================================================
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Provider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderClientRelationship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Provider
-- ============================================================================

-- Super Admin: only standalone Providers (governance/creation scope).
CREATE POLICY provider_select_super_admin ON "Provider" FOR SELECT
  USING (current_setting('app.role', true) = 'super_admin' AND mode = 'standalone');
CREATE POLICY provider_modify_super_admin ON "Provider" FOR ALL
  USING (current_setting('app.role', true) = 'super_admin' AND mode = 'standalone')
  WITH CHECK (current_setting('app.role', true) = 'super_admin');

-- Provider User: only their own Provider row.
CREATE POLICY provider_select_own ON "Provider" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND id = NULLIF(current_setting('app.provider_id', true), '')
  );

-- Client Admin: a Provider is visible only via an ACTIVE relationship to their Client.
CREATE POLICY provider_select_client_admin ON "Provider" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r."providerId" = "Provider".id
        AND r."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND r.status = 'active'
    )
  );
CREATE POLICY provider_modify_client_admin ON "Provider" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r."providerId" = "Provider".id
        AND r."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND r.status = 'active'
    )
  )
  WITH CHECK (current_setting('app.role', true) = 'client_admin');

-- Insert path: whoever is creating a Provider needs an INSERT policy of their own.
CREATE POLICY provider_insert_super_admin ON "Provider" FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'super_admin');
CREATE POLICY provider_insert_client_admin ON "Provider" FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'client_admin');

-- ============================================================================
-- Client
-- ============================================================================

CREATE POLICY client_all_super_admin ON "Client" FOR ALL
  USING (current_setting('app.role', true) = 'super_admin')
  WITH CHECK (current_setting('app.role', true) = 'super_admin');

CREATE POLICY client_select_own ON "Client" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND id = NULLIF(current_setting('app.client_id', true), '')
  );
CREATE POLICY client_update_own ON "Client" FOR UPDATE
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND id = NULLIF(current_setting('app.client_id', true), '')
  )
  WITH CHECK (id = NULLIF(current_setting('app.client_id', true), ''));

-- Provider User: only Clients they have (any-status) relationship with — used
-- for the Connections screen, e.g. to show a pending/suspended relationship's Client name.
CREATE POLICY client_select_via_relationship ON "Client" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r."clientId" = "Client".id
        AND r."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );

-- ============================================================================
-- ProviderClientRelationship
-- ============================================================================

CREATE POLICY relationship_select_super_admin ON "ProviderClientRelationship" FOR SELECT
  USING (current_setting('app.role', true) = 'super_admin');

CREATE POLICY relationship_all_client_admin ON "ProviderClientRelationship" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  );

-- Provider User: view their own Provider's relationships, and update (accept) a pending one.
CREATE POLICY relationship_select_provider_user ON "ProviderClientRelationship" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "providerId" = NULLIF(current_setting('app.provider_id', true), '')
  );
CREATE POLICY relationship_update_provider_user ON "ProviderClientRelationship" FOR UPDATE
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "providerId" = NULLIF(current_setting('app.provider_id', true), '')
  )
  WITH CHECK ("providerId" = NULLIF(current_setting('app.provider_id', true), ''));

-- ============================================================================
-- User
-- ============================================================================

-- Everyone can always read (and update permitted fields of) their own row —
-- needed for session/profile lookups regardless of role.
CREATE POLICY user_select_self ON "User" FOR SELECT
  USING (id = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY user_update_self ON "User" FOR UPDATE
  USING (id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), ''));

-- Super Admin: Super Admins, Client Admins, and Provider Users of STANDALONE
-- Providers — never a Provider User whose Provider is client_connected.
CREATE POLICY user_select_super_admin ON "User" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND (
      role IN ('super_admin', 'client_admin')
      OR (
        role = 'provider_user'
        AND "providerId" IN (SELECT id FROM "Provider" WHERE mode = 'standalone')
      )
    )
  );
CREATE POLICY user_modify_super_admin ON "User" FOR ALL
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND (
      role IN ('super_admin', 'client_admin')
      OR (
        role = 'provider_user'
        AND "providerId" IN (SELECT id FROM "Provider" WHERE mode = 'standalone')
      )
    )
  )
  WITH CHECK (current_setting('app.role', true) = 'super_admin');

-- Client Admin: other Admins of the same Client, and Provider Users of
-- Providers with an ACTIVE relationship to their Client.
CREATE POLICY user_select_client_admin ON "User" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND (
      "clientId" = NULLIF(current_setting('app.client_id', true), '')
      OR "providerId" IN (
        SELECT r."providerId" FROM "ProviderClientRelationship" r
        WHERE r."clientId" = NULLIF(current_setting('app.client_id', true), '')
          AND r.status = 'active'
      )
    )
  );
CREATE POLICY user_modify_client_admin ON "User" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND (
      "clientId" = NULLIF(current_setting('app.client_id', true), '')
      OR "providerId" IN (
        SELECT r."providerId" FROM "ProviderClientRelationship" r
        WHERE r."clientId" = NULLIF(current_setting('app.client_id', true), '')
          AND r.status = 'active'
      )
    )
  )
  WITH CHECK (current_setting('app.role', true) = 'client_admin');

-- Provider User: colleagues within the same Provider (read-only — provider_case_access
-- style collaboration is a Segment 4 concern; for now this just supports listing colleagues).
CREATE POLICY user_select_provider_user ON "User" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "providerId" = NULLIF(current_setting('app.provider_id', true), '')
  );

-- Insert path: account creation is always performed by an Admin role.
CREATE POLICY user_insert_super_admin ON "User" FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'super_admin');
CREATE POLICY user_insert_client_admin ON "User" FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'client_admin');

-- ============================================================================
-- Invitation — scoped through the invited User's own visibility.
-- ============================================================================

CREATE POLICY invitation_select_via_user ON "Invitation" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "Invitation"."userId"
        AND (
          u.id = NULLIF(current_setting('app.user_id', true), '')
          OR (
            current_setting('app.role', true) = 'super_admin'
            AND (
              u.role IN ('super_admin', 'client_admin')
              OR u."providerId" IN (SELECT id FROM "Provider" WHERE mode = 'standalone')
            )
          )
          OR (
            current_setting('app.role', true) = 'client_admin'
            AND (
              u."clientId" = NULLIF(current_setting('app.client_id', true), '')
              OR u."providerId" IN (
                SELECT r."providerId" FROM "ProviderClientRelationship" r
                WHERE r."clientId" = NULLIF(current_setting('app.client_id', true), '')
                  AND r.status = 'active'
              )
            )
          )
        )
    )
  );
CREATE POLICY invitation_all_admins ON "Invitation" FOR ALL
  USING (current_setting('app.role', true) IN ('super_admin', 'client_admin'))
  WITH CHECK (current_setting('app.role', true) IN ('super_admin', 'client_admin'));

-- ============================================================================
-- Session — a user (and the auth layer) may only ever touch their own sessions.
-- ============================================================================

CREATE POLICY session_all_self ON "Session" FOR ALL
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));

-- Admins may revoke a managed user's sessions on suspend/deactivate.
CREATE POLICY session_admin_manage ON "Session" FOR ALL
  USING (
    current_setting('app.role', true) IN ('super_admin', 'client_admin')
  )
  WITH CHECK (
    current_setting('app.role', true) IN ('super_admin', 'client_admin')
  );

-- ============================================================================
-- AuditEvent — append-only. No UPDATE/DELETE policy at all = default deny.
-- ============================================================================

CREATE POLICY audit_insert_any ON "AuditEvent" FOR INSERT WITH CHECK (true);

CREATE POLICY audit_select_super_admin ON "AuditEvent" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND "caseId" IS NULL -- future-proofing: Super Admin never sees Case-linked audit rows once Case exists
  );

CREATE POLICY audit_select_client_admin ON "AuditEvent" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  );

CREATE POLICY audit_select_provider_user ON "AuditEvent" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "providerId" = NULLIF(current_setting('app.provider_id', true), '')
  );
