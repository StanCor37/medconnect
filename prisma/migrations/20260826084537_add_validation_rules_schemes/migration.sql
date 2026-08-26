-- CreateEnum
CREATE TYPE "OwnershipScope" AS ENUM ('global', 'client');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('document_requirement', 'field_extraction', 'data_consistency', 'date_validation', 'eligibility', 'medical_clause', 'financial_validation', 'fraud_indicator');

-- CreateEnum
CREATE TYPE "RuleExecutionType" AS ENUM ('deterministic', 'ai_assisted');

-- CreateEnum
CREATE TYPE "DeterministicOperation" AS ENUM ('required_document', 'required_field', 'equals', 'not_equals', 'date_between', 'date_before', 'date_after', 'amount_less_than_or_equal', 'amount_greater_than');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('info', 'warning', 'blocking');

-- CreateEnum
CREATE TYPE "HitlPolicy" AS ENUM ('never', 'on_needs_review', 'on_fail', 'always');

-- CreateTable
CREATE TABLE "ValidationRule" (
    "id" TEXT NOT NULL,
    "scope" "OwnershipScope" NOT NULL,
    "clientId" TEXT,
    "category" "RuleCategory" NOT NULL,
    "executionType" "RuleExecutionType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'draft',
    "currentVersionId" TEXT,
    "sourceRuleId" TEXT,
    "sourceRuleVersionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "applicability" JSONB NOT NULL DEFAULT '{}',
    "providerMessageCode" TEXT NOT NULL,
    "adminMessageCode" TEXT NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "hitlPolicy" "HitlPolicy" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationScheme" (
    "id" TEXT NOT NULL,
    "scope" "OwnershipScope" NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "insurerId" TEXT,
    "productLine" TEXT,
    "productId" TEXT,
    "countryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PublicationStatus" NOT NULL DEFAULT 'draft',
    "currentVersionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ValidationScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationSchemeVersion" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationSchemeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationSchemeRule" (
    "id" TEXT NOT NULL,
    "schemeVersionId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "executionOrder" INTEGER NOT NULL DEFAULT 0,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "hitlPolicyOverride" "HitlPolicy",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationSchemeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ValidationRule_currentVersionId_key" ON "ValidationRule"("currentVersionId");

-- CreateIndex
CREATE INDEX "ValidationRule_scope_idx" ON "ValidationRule"("scope");

-- CreateIndex
CREATE INDEX "ValidationRule_clientId_idx" ON "ValidationRule"("clientId");

-- CreateIndex
CREATE INDEX "ValidationRule_status_idx" ON "ValidationRule"("status");

-- CreateIndex
CREATE INDEX "ValidationRule_category_idx" ON "ValidationRule"("category");

-- CreateIndex
CREATE INDEX "ValidationRuleVersion_ruleId_idx" ON "ValidationRuleVersion"("ruleId");

-- CreateIndex
CREATE INDEX "ValidationRuleVersion_publishedAt_idx" ON "ValidationRuleVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationRuleVersion_ruleId_versionNumber_key" ON "ValidationRuleVersion"("ruleId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationScheme_currentVersionId_key" ON "ValidationScheme"("currentVersionId");

-- CreateIndex
CREATE INDEX "ValidationScheme_scope_idx" ON "ValidationScheme"("scope");

-- CreateIndex
CREATE INDEX "ValidationScheme_clientId_idx" ON "ValidationScheme"("clientId");

-- CreateIndex
CREATE INDEX "ValidationScheme_status_idx" ON "ValidationScheme"("status");

-- CreateIndex
CREATE INDEX "ValidationSchemeVersion_schemeId_idx" ON "ValidationSchemeVersion"("schemeId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationSchemeVersion_schemeId_versionNumber_key" ON "ValidationSchemeVersion"("schemeId", "versionNumber");

-- CreateIndex
CREATE INDEX "ValidationSchemeRule_schemeVersionId_idx" ON "ValidationSchemeRule"("schemeVersionId");

-- CreateIndex
CREATE INDEX "ValidationSchemeRule_ruleVersionId_idx" ON "ValidationSchemeRule"("ruleVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationSchemeRule_schemeVersionId_ruleVersionId_key" ON "ValidationSchemeRule"("schemeVersionId", "ruleVersionId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_validationSchemeVersionId_fkey" FOREIGN KEY ("validationSchemeVersionId") REFERENCES "ValidationSchemeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ValidationRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_sourceRuleId_fkey" FOREIGN KEY ("sourceRuleId") REFERENCES "ValidationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_sourceRuleVersionId_fkey" FOREIGN KEY ("sourceRuleVersionId") REFERENCES "ValidationRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRuleVersion" ADD CONSTRAINT "ValidationRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ValidationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRuleVersion" ADD CONSTRAINT "ValidationRuleVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationScheme" ADD CONSTRAINT "ValidationScheme_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationScheme" ADD CONSTRAINT "ValidationScheme_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationScheme" ADD CONSTRAINT "ValidationScheme_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ValidationSchemeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationScheme" ADD CONSTRAINT "ValidationScheme_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationSchemeVersion" ADD CONSTRAINT "ValidationSchemeVersion_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "ValidationScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationSchemeVersion" ADD CONSTRAINT "ValidationSchemeVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationSchemeRule" ADD CONSTRAINT "ValidationSchemeRule_schemeVersionId_fkey" FOREIGN KEY ("schemeVersionId") REFERENCES "ValidationSchemeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationSchemeRule" ADD CONSTRAINT "ValidationSchemeRule_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "ValidationRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Segment 3 — ValidationRule / ValidationRuleVersion / ValidationScheme /
-- ValidationSchemeVersion / ValidationSchemeRule
--
-- Shape (same across all 5 tables): Super Admin gets FOR ALL on scope=global
-- rows plus a FOR SELECT-only policy on scope=client rows (real governance
-- read access — unlike Case's zero-access rule, Super Admin genuinely needs
-- Client-owned rule/scheme visibility per spec Segment 3 Sections 2-3).
-- Client Admin gets FOR ALL on their own Client's rows plus FOR SELECT on
-- published global rows. Provider User gets FOR SELECT only, on published
-- global rows plus published rows owned by a Client they have an ACTIVE
-- relationship with. Version/Rule-pairing tables inherit the same shape via
-- an EXISTS join back to their parent Rule/Scheme (they carry no
-- scope/clientId of their own).
-- ============================================================================

ALTER TABLE "ValidationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationRuleVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationScheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationSchemeVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationSchemeRule" ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- ValidationRule
-- ----------------------------------------------------------------------------

CREATE POLICY rule_all_super_admin_global ON "ValidationRule" FOR ALL
  USING (current_setting('app.role', true) = 'super_admin' AND scope = 'global')
  WITH CHECK (current_setting('app.role', true) = 'super_admin' AND scope = 'global');
CREATE POLICY rule_select_super_admin_client_owned ON "ValidationRule" FOR SELECT
  USING (current_setting('app.role', true) = 'super_admin' AND scope = 'client');

CREATE POLICY rule_all_client_admin_own ON "ValidationRule" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND scope = 'client'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  );
CREATE POLICY rule_select_client_admin_global ON "ValidationRule" FOR SELECT
  USING (current_setting('app.role', true) = 'client_admin' AND scope = 'global' AND status = 'published');

CREATE POLICY rule_select_provider_user_global ON "ValidationRule" FOR SELECT
  USING (current_setting('app.role', true) = 'provider_user' AND scope = 'global' AND status = 'published');
CREATE POLICY rule_select_provider_user_client_owned ON "ValidationRule" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND scope = 'client' AND status = 'published'
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r."clientId" = "ValidationRule"."clientId"
        AND r."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND r.status = 'active'
    )
  );

-- ----------------------------------------------------------------------------
-- ValidationRuleVersion — joined through ruleId, same visibility shape.
-- ----------------------------------------------------------------------------

CREATE POLICY rule_version_all_super_admin_global ON "ValidationRuleVersion" FOR ALL
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId" AND ru.scope = 'global')
  )
  WITH CHECK (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId" AND ru.scope = 'global')
  );
CREATE POLICY rule_version_select_super_admin_client_owned ON "ValidationRuleVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId" AND ru.scope = 'client')
  );

CREATE POLICY rule_version_all_client_admin_own ON "ValidationRuleVersion" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId"
        AND ru.scope = 'client' AND ru."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId"
        AND ru."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );
CREATE POLICY rule_version_select_client_admin_global ON "ValidationRuleVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "publishedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId" AND ru.scope = 'global')
  );

CREATE POLICY rule_version_select_provider_user_global ON "ValidationRuleVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "publishedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ValidationRule" ru WHERE ru.id = "ValidationRuleVersion"."ruleId" AND ru.scope = 'global')
  );
CREATE POLICY rule_version_select_provider_user_client_owned ON "ValidationRuleVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND "publishedAt" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "ValidationRule" ru
      JOIN "ProviderClientRelationship" pcr
        ON pcr."clientId" = ru."clientId" AND pcr.status = 'active'
        AND pcr."providerId" = NULLIF(current_setting('app.provider_id', true), '')
      WHERE ru.id = "ValidationRuleVersion"."ruleId" AND ru.scope = 'client'
    )
  );

-- ----------------------------------------------------------------------------
-- ValidationScheme — identical shape to ValidationRule.
-- ----------------------------------------------------------------------------

CREATE POLICY scheme_all_super_admin_global ON "ValidationScheme" FOR ALL
  USING (current_setting('app.role', true) = 'super_admin' AND scope = 'global')
  WITH CHECK (current_setting('app.role', true) = 'super_admin' AND scope = 'global');
CREATE POLICY scheme_select_super_admin_client_owned ON "ValidationScheme" FOR SELECT
  USING (current_setting('app.role', true) = 'super_admin' AND scope = 'client');

CREATE POLICY scheme_all_client_admin_own ON "ValidationScheme" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND scope = 'client' AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  );
CREATE POLICY scheme_select_client_admin_global ON "ValidationScheme" FOR SELECT
  USING (current_setting('app.role', true) = 'client_admin' AND scope = 'global' AND status = 'published');

CREATE POLICY scheme_select_provider_user_global ON "ValidationScheme" FOR SELECT
  USING (current_setting('app.role', true) = 'provider_user' AND scope = 'global' AND status = 'published');
CREATE POLICY scheme_select_provider_user_client_owned ON "ValidationScheme" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND scope = 'client' AND status = 'published'
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r."clientId" = "ValidationScheme"."clientId"
        AND r."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND r.status = 'active'
    )
  );

-- ----------------------------------------------------------------------------
-- ValidationSchemeVersion — joined through schemeId, same shape.
-- ----------------------------------------------------------------------------

CREATE POLICY scheme_version_all_super_admin_global ON "ValidationSchemeVersion" FOR ALL
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId" AND s.scope = 'global')
  )
  WITH CHECK (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId" AND s.scope = 'global')
  );
CREATE POLICY scheme_version_select_super_admin_client_owned ON "ValidationSchemeVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId" AND s.scope = 'client')
  );
CREATE POLICY scheme_version_all_client_admin_own ON "ValidationSchemeVersion" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId"
        AND s.scope = 'client' AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId"
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );
CREATE POLICY scheme_version_select_client_admin_global ON "ValidationSchemeVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin' AND "publishedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId" AND s.scope = 'global')
  );
CREATE POLICY scheme_version_select_provider_user_global ON "ValidationSchemeVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user' AND "publishedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ValidationScheme" s WHERE s.id = "ValidationSchemeVersion"."schemeId" AND s.scope = 'global')
  );
CREATE POLICY scheme_version_select_provider_user_client_owned ON "ValidationSchemeVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user' AND "publishedAt" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "ValidationScheme" s
      JOIN "ProviderClientRelationship" pcr
        ON pcr."clientId" = s."clientId" AND pcr.status = 'active'
        AND pcr."providerId" = NULLIF(current_setting('app.provider_id', true), '')
      WHERE s.id = "ValidationSchemeVersion"."schemeId" AND s.scope = 'client'
    )
  );

-- ----------------------------------------------------------------------------
-- ValidationSchemeRule — inherits visibility from its schemeVersionId parent.
-- ----------------------------------------------------------------------------

CREATE POLICY scheme_rule_all_super_admin_global ON "ValidationSchemeRule" FOR ALL
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId" AND s.scope = 'global'
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId" AND s.scope = 'global'
    )
  );
CREATE POLICY scheme_rule_select_super_admin_client_owned ON "ValidationSchemeRule" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId" AND s.scope = 'client'
    )
  );
CREATE POLICY scheme_rule_all_client_admin_own ON "ValidationSchemeRule" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId" AND s.scope = 'client'
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId"
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );
CREATE POLICY scheme_rule_select_client_admin_global ON "ValidationSchemeRule" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId" AND s.scope = 'global' AND s.status = 'published'
    )
  );
CREATE POLICY scheme_rule_select_provider_user ON "ValidationSchemeRule" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "ValidationSchemeRule"."schemeVersionId" AND s.status = 'published'
        AND (
          s.scope = 'global'
          OR EXISTS (
            SELECT 1 FROM "ProviderClientRelationship" r
            WHERE r."clientId" = s."clientId" AND r.status = 'active'
              AND r."providerId" = NULLIF(current_setting('app.provider_id', true), '')
          )
        )
    )
  );
