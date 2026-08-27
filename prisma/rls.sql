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
    AND "caseId" IS NULL
    -- Segment 4: AuditEvent.caseId is ON DELETE SET NULL, so a hard-deleted
    -- Case's own audit rows would have caseId nulled and start satisfying
    -- "caseId IS NULL" alone — checking targetType too closes that leak.
    AND "targetType" != 'Case'
  );

-- ============================================================================
-- Case (Segment 4) — the ONE table where Super Admin gets NO policy at all.
-- This is deliberate: Super Admin has zero Case visibility, not even the
-- standalone-only carve-out every other resource type gives it. Do not add
-- a super_admin policy here, ever.
-- ============================================================================

ALTER TABLE "Case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Insurer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;

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

-- Client Admin: visible only via an ACTIVE relationship — mirrors
-- scopedCaseWhere exactly. Recognizing an insurer never substitutes for this.
CREATE POLICY case_select_client_admin ON "Case" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r.id = "Case"."providerClientRelationshipId" AND r.status = 'active'
    )
  );

-- Insurer: non-tenant reference data, readable by any authenticated role.
CREATE POLICY insurer_select_any ON "Insurer" FOR SELECT USING (true);

-- IdempotencyKey: purely internal replay bookkeeping, scoped per-Provider.
CREATE POLICY idempotency_key_all_own_provider ON "IdempotencyKey" FOR ALL
  USING ("providerId" = NULLIF(current_setting('app.provider_id', true), ''))
  WITH CHECK ("providerId" = NULLIF(current_setting('app.provider_id', true), ''));

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

-- ============================================================================
-- Segment 5 — Document Upload and Versioning.
--
-- DocumentTypeDefinition inherits visibility from its schemeVersionId parent
-- — identical shape to ValidationSchemeRule's policies above, just renamed.
--
-- Document / SourceFile / DocumentVersion / DocumentPageReference all
-- inherit from the parent Case, and — like Case itself — get NO super_admin
-- policy at all ("Super Admin is always denied", spec Section 25). Do not
-- add a super_admin policy to any of these five tables, ever.
-- ============================================================================

ALTER TABLE "DocumentTypeDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentPageReference" ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- DocumentTypeDefinition — same shape as ValidationSchemeRule.
-- ----------------------------------------------------------------------------

CREATE POLICY document_type_all_super_admin_global ON "DocumentTypeDefinition" FOR ALL
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId" AND s.scope = 'global'
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId" AND s.scope = 'global'
    )
  );
CREATE POLICY document_type_select_super_admin_client_owned ON "DocumentTypeDefinition" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId" AND s.scope = 'client'
    )
  );
CREATE POLICY document_type_all_client_admin_own ON "DocumentTypeDefinition" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId" AND s.scope = 'client'
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId"
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );
CREATE POLICY document_type_select_client_admin_global ON "DocumentTypeDefinition" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId" AND s.scope = 'global' AND s.status = 'published'
    )
  );
CREATE POLICY document_type_select_provider_user ON "DocumentTypeDefinition" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "ValidationSchemeVersion" sv JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE sv.id = "DocumentTypeDefinition"."schemeVersionId" AND s.status = 'published'
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

-- ----------------------------------------------------------------------------
-- Document — mirrors Case's own policies exactly, joined through caseId.
-- ----------------------------------------------------------------------------

CREATE POLICY document_select_provider_user ON "Document" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "Document"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY document_modify_provider_user ON "Document" FOR ALL
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "Document"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "Document"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );
CREATE POLICY document_select_client_admin ON "Document" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "Document"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- SourceFile — same shape as Document, joined through its own caseId column.
-- ----------------------------------------------------------------------------

CREATE POLICY source_file_select_provider_user ON "SourceFile" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "SourceFile"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY source_file_modify_provider_user ON "SourceFile" FOR ALL
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "SourceFile"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "SourceFile"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );
CREATE POLICY source_file_select_client_admin ON "SourceFile" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "SourceFile"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- DocumentVersion — inherits visibility via documentId -> Document.caseId.
-- ----------------------------------------------------------------------------

CREATE POLICY document_version_select_provider_user ON "DocumentVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Document" d JOIN "Case" c ON c.id = d."caseId"
      WHERE d.id = "DocumentVersion"."documentId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY document_version_modify_provider_user ON "DocumentVersion" FOR ALL
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Document" d JOIN "Case" c ON c.id = d."caseId"
      WHERE d.id = "DocumentVersion"."documentId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Document" d JOIN "Case" c ON c.id = d."caseId"
      WHERE d.id = "DocumentVersion"."documentId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );
CREATE POLICY document_version_select_client_admin ON "DocumentVersion" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Document" d JOIN "Case" c ON c.id = d."caseId"
      WHERE d.id = "DocumentVersion"."documentId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- DocumentPageReference — inherits visibility via sourceFileId -> SourceFile.caseId.
-- ----------------------------------------------------------------------------

CREATE POLICY document_page_ref_select_provider_user ON "DocumentPageReference" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "SourceFile" sf JOIN "Case" c ON c.id = sf."caseId"
      WHERE sf.id = "DocumentPageReference"."sourceFileId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY document_page_ref_modify_provider_user ON "DocumentPageReference" FOR ALL
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "SourceFile" sf JOIN "Case" c ON c.id = sf."caseId"
      WHERE sf.id = "DocumentPageReference"."sourceFileId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "SourceFile" sf JOIN "Case" c ON c.id = sf."caseId"
      WHERE sf.id = "DocumentPageReference"."sourceFileId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );
CREATE POLICY document_page_ref_select_client_admin ON "DocumentPageReference" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "SourceFile" sf JOIN "Case" c ON c.id = sf."caseId"
      WHERE sf.id = "DocumentPageReference"."sourceFileId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ============================================================================
-- Segment 6 — AI Extraction and Classification.
--
-- ExtractionFieldDefinition is catalog/config (like DocumentTypeDefinition),
-- not a per-Case processing artifact — same 5-policy shape, joined one level
-- further through documentTypeId.
--
-- DocumentClassificationResult / OcrPageResult / ExtractedField /
-- DocumentProcessingJob are per-Case processing artifacts containing PII/
-- evidence — mirror Document's zero-super_admin-access shape exactly (spec
-- §30: "Super Admin cannot access processing inputs or results"). Do not add
-- a super_admin policy to any of these four tables, ever.
-- ============================================================================

ALTER TABLE "ExtractionFieldDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentClassificationResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OcrPageResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExtractedField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentProcessingJob" ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- ExtractionFieldDefinition — same shape as DocumentTypeDefinition, joined
-- one level further through documentTypeId -> DocumentTypeDefinition.schemeVersionId.
-- ----------------------------------------------------------------------------

CREATE POLICY extraction_field_def_all_super_admin_global ON "ExtractionFieldDefinition" FOR ALL
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId" AND s.scope = 'global'
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId" AND s.scope = 'global'
    )
  );
CREATE POLICY extraction_field_def_select_super_admin_client_owned ON "ExtractionFieldDefinition" FOR SELECT
  USING (
    current_setting('app.role', true) = 'super_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId" AND s.scope = 'client'
    )
  );
CREATE POLICY extraction_field_def_all_client_admin_own ON "ExtractionFieldDefinition" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId" AND s.scope = 'client'
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId"
        AND s."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );
CREATE POLICY extraction_field_def_select_client_admin_global ON "ExtractionFieldDefinition" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId" AND s.scope = 'global' AND s.status = 'published'
    )
  );
CREATE POLICY extraction_field_def_select_provider_user ON "ExtractionFieldDefinition" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "DocumentTypeDefinition" dt
      JOIN "ValidationSchemeVersion" sv ON sv.id = dt."schemeVersionId"
      JOIN "ValidationScheme" s ON s.id = sv."schemeId"
      WHERE dt.id = "ExtractionFieldDefinition"."documentTypeId" AND s.status = 'published'
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

-- ----------------------------------------------------------------------------
-- DocumentClassificationResult — machine-written history, read-only from
-- every actor's perspective (like AuditEvent) — no modify policy for any
-- role; the app writes these as the owner connection, bypassing RLS, same as
-- every other table while RLS stays dormant (see README). Joined via
-- documentVersionId -> DocumentVersion.documentId -> Document.caseId -> Case.
-- ----------------------------------------------------------------------------

CREATE POLICY classification_result_select_provider_user ON "DocumentClassificationResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId" JOIN "Case" c ON c.id = d."caseId"
      WHERE dv.id = "DocumentClassificationResult"."documentVersionId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY classification_result_select_client_admin ON "DocumentClassificationResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId" JOIN "Case" c ON c.id = d."caseId"
      WHERE dv.id = "DocumentClassificationResult"."documentVersionId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- OcrPageResult — same shape and same read-only-from-every-actor reasoning
-- as DocumentClassificationResult.
-- ----------------------------------------------------------------------------

CREATE POLICY ocr_page_result_select_provider_user ON "OcrPageResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId" JOIN "Case" c ON c.id = d."caseId"
      WHERE dv.id = "OcrPageResult"."documentVersionId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY ocr_page_result_select_client_admin ON "OcrPageResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId" JOIN "Case" c ON c.id = d."caseId"
      WHERE dv.id = "OcrPageResult"."documentVersionId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- ExtractedField — the one table in this group a Provider User genuinely
-- modifies directly (confirm/correct a value, spec §17), so it gets a modify
-- policy mirroring Document's shape, not just select. Joins via its own
-- caseId column directly — no need to traverse through documentVersionId.
-- ----------------------------------------------------------------------------

CREATE POLICY extracted_field_select_provider_user ON "ExtractedField" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ExtractedField"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY extracted_field_modify_provider_user ON "ExtractedField" FOR ALL
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ExtractedField"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ExtractedField"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );
CREATE POLICY extracted_field_select_client_admin ON "ExtractedField" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ExtractedField"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- DocumentProcessingJob — machine/system-managed, read-only from every
-- actor's perspective, same reasoning as DocumentClassificationResult.
-- ----------------------------------------------------------------------------

CREATE POLICY processing_job_select_provider_user ON "DocumentProcessingJob" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId" JOIN "Case" c ON c.id = d."caseId"
      WHERE dv.id = "DocumentProcessingJob"."documentVersionId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY processing_job_select_client_admin ON "DocumentProcessingJob" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId" JOIN "Case" c ON c.id = d."caseId"
      WHERE dv.id = "DocumentProcessingJob"."documentVersionId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ============================================================================
-- Segment 7 — Validation Process and Results.
--
-- ValidationRun/ValidationRuleResult/RequirementResult follow
-- DocumentProcessingJob's shape exactly: joined via caseId (ValidationRun,
-- ValidationRuleResult, RequirementResult all carry it directly or via
-- validationRunId), Super Admin gets zero access (same absolute rule as
-- every Case-linked table), Provider User and Client Admin both get
-- read-only SELECT — these rows are engine-written, never hand-edited by
-- either actor. ValidationRun ALSO needs an INSERT/ALL policy since
-- *triggering* a run (case.validate / case.requestRevalidation) is a real
-- user action, unlike DocumentProcessingJob which no one ever directly
-- creates. HitlTask/HitlDecision get their own block below since Client
-- Admin genuinely modifies them (deciding a HITL task, spec §17/§19).
-- ============================================================================

ALTER TABLE "ValidationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationRuleResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequirementResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HitlTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HitlDecision" ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- ValidationRun
-- ----------------------------------------------------------------------------

CREATE POLICY validation_run_select_provider_user ON "ValidationRun" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ValidationRun"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY validation_run_insert_provider_user ON "ValidationRun" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ValidationRun"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
    )
  );
CREATE POLICY validation_run_select_client_admin ON "ValidationRun" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ValidationRun"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );
CREATE POLICY validation_run_insert_client_admin ON "ValidationRun" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ValidationRun"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );

-- ----------------------------------------------------------------------------
-- ValidationRuleResult / RequirementResult — engine-written only, read-only
-- from every actor, same reasoning as DocumentClassificationResult.
-- ----------------------------------------------------------------------------

CREATE POLICY rule_result_select_provider_user ON "ValidationRuleResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ValidationRuleResult"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY rule_result_select_client_admin ON "ValidationRuleResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "ValidationRuleResult"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );
-- INSERT policies are required alongside SELECT since RLS defaults to
-- deny-all per command, not just per row — the engine writes these rows
-- under whichever actor triggered the run.
CREATE POLICY rule_result_insert_provider_user ON "ValidationRuleResult" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (SELECT 1 FROM "Case" c WHERE c.id = "ValidationRuleResult"."caseId" AND c."providerId" = NULLIF(current_setting('app.provider_id', true), ''))
  );
CREATE POLICY rule_result_insert_client_admin ON "ValidationRuleResult" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (SELECT 1 FROM "Case" c WHERE c.id = "ValidationRuleResult"."caseId" AND c."clientId" = NULLIF(current_setting('app.client_id', true), ''))
  );

CREATE POLICY requirement_result_select_provider_user ON "RequirementResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "RequirementResult"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY requirement_result_select_client_admin ON "RequirementResult" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "RequirementResult"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );
CREATE POLICY requirement_result_insert_provider_user ON "RequirementResult" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (SELECT 1 FROM "Case" c WHERE c.id = "RequirementResult"."caseId" AND c."providerId" = NULLIF(current_setting('app.provider_id', true), ''))
  );
CREATE POLICY requirement_result_insert_client_admin ON "RequirementResult" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (SELECT 1 FROM "Case" c WHERE c.id = "RequirementResult"."caseId" AND c."clientId" = NULLIF(current_setting('app.client_id', true), ''))
  );

-- ----------------------------------------------------------------------------
-- HitlTask / HitlDecision — never created for a standalone Case
-- (assignedClientId is NOT NULL, enforced at the app layer, never by RLS
-- alone). Provider User: read-only (spec §15 "inspect evidence", never
-- decide). Client Admin: full access to tasks assigned to their own Client
-- with an active relationship — re-checked on every access, not just at
-- creation, per spec §29 "Client HITL requires... active relationship."
-- ----------------------------------------------------------------------------

CREATE POLICY hitl_task_select_provider_user ON "HitlTask" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "HitlTask"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY hitl_task_all_client_admin ON "HitlTask" FOR ALL
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "assignedClientId" = NULLIF(current_setting('app.client_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "HitlTask"."caseId"
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  )
  WITH CHECK (
    "assignedClientId" = NULLIF(current_setting('app.client_id', true), '')
  );

CREATE POLICY hitl_decision_select_provider_user ON "HitlDecision" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "HitlTask" t JOIN "Case" c ON c.id = t."caseId"
      WHERE t.id = "HitlDecision"."hitlTaskId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY hitl_decision_select_client_admin ON "HitlDecision" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "HitlTask" t WHERE t.id = "HitlDecision"."hitlTaskId"
        AND t."assignedClientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );
CREATE POLICY hitl_decision_insert_client_admin ON "HitlDecision" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "HitlTask" t WHERE t.id = "HitlDecision"."hitlTaskId"
        AND t."assignedClientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );

-- ============================================================================
-- Segment 8 — Case Statuses and Lifecycle.
--
-- Client Admin never had a "Case" MODIFY policy before this segment (only
-- SELECT) — Segment 8 gives Client Admin its first-ever real mutation
-- authority over a Case (accept/reject/liquidate/return/etc.), so a real
-- UPDATE policy is added here for the first time, restricted to the same
-- active-relationship condition the existing SELECT policy already uses.
-- Provider retains its existing case_modify_provider_user policy unchanged.
-- CaseStatusHistory/CaseSubmission both follow ValidationRun's shape:
-- joined via caseId, Super Admin gets zero access, both remaining roles get
-- SELECT + the INSERT their own actions actually produce.
-- ============================================================================

ALTER TABLE "CaseStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseSubmission" ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_modify_client_admin ON "Case" FOR UPDATE
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "ProviderClientRelationship" r
      WHERE r.id = "Case"."providerClientRelationshipId" AND r.status = 'active'
    )
  )
  WITH CHECK ("clientId" = NULLIF(current_setting('app.client_id', true), ''));

-- ----------------------------------------------------------------------------
-- CaseStatusHistory
-- ----------------------------------------------------------------------------

CREATE POLICY case_status_history_select_provider_user ON "CaseStatusHistory" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "CaseStatusHistory"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY case_status_history_insert_provider_user ON "CaseStatusHistory" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (SELECT 1 FROM "Case" c WHERE c.id = "CaseStatusHistory"."caseId" AND c."providerId" = NULLIF(current_setting('app.provider_id', true), ''))
  );
CREATE POLICY case_status_history_select_client_admin ON "CaseStatusHistory" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "CaseStatusHistory"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "ProviderClientRelationship" r
          WHERE r.id = c."providerClientRelationshipId" AND r.status = 'active'
        )
    )
  );
CREATE POLICY case_status_history_insert_client_admin ON "CaseStatusHistory" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'client_admin'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "CaseStatusHistory"."caseId"
        AND c."clientId" = NULLIF(current_setting('app.client_id', true), '')
    )
  );

-- ----------------------------------------------------------------------------
-- CaseSubmission — Provider-created only (spec §4: submission is an explicit
-- Provider action); Client Admin is read-only.
-- ----------------------------------------------------------------------------

CREATE POLICY case_submission_select_provider_user ON "CaseSubmission" FOR SELECT
  USING (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (
      SELECT 1 FROM "Case" c WHERE c.id = "CaseSubmission"."caseId"
        AND c."providerId" = NULLIF(current_setting('app.provider_id', true), '')
        AND (
          c."providerCaseAccess" = 'provider_shared'
          OR (c."providerCaseAccess" = 'creator_only' AND c."createdByUserId" = NULLIF(current_setting('app.user_id', true), ''))
        )
    )
  );
CREATE POLICY case_submission_insert_provider_user ON "CaseSubmission" FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'provider_user'
    AND EXISTS (SELECT 1 FROM "Case" c WHERE c.id = "CaseSubmission"."caseId" AND c."providerId" = NULLIF(current_setting('app.provider_id', true), ''))
  );
CREATE POLICY case_submission_select_client_admin ON "CaseSubmission" FOR SELECT
  USING (
    current_setting('app.role', true) = 'client_admin'
    AND "clientId" = NULLIF(current_setting('app.client_id', true), '')
  );
