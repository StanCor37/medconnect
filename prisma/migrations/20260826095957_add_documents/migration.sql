-- CreateEnum
CREATE TYPE "MalwareScanStatus" AS ENUM ('pending', 'skipped', 'clean', 'infected', 'failed');

-- CreateEnum
CREATE TYPE "ReadabilityStatus" AS ENUM ('pending', 'readable', 'partially_readable', 'unreadable', 'password_protected', 'corrupted');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('pending', 'processing', 'suggested', 'confirmed', 'unclear', 'failed');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploading', 'processing', 'needs_type_confirmation', 'needs_split_confirmation', 'ready', 'partially_readable', 'unreadable', 'failed', 'archived');

-- CreateEnum
CREATE TYPE "ReplacementReason" AS ENUM ('clearer_copy', 'missing_pages', 'corrected_document', 'wrong_document', 'updated_information', 'requested_by_client', 'other');

-- CreateTable
CREATE TABLE "DocumentTypeDefinition" (
    "id" TEXT NOT NULL,
    "schemeVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "acceptedMimeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "multipleAllowed" BOOLEAN NOT NULL DEFAULT true,
    "expectedFields" JSONB NOT NULL DEFAULT '[]',
    "classificationHints" JSONB NOT NULL DEFAULT '[]',
    "captureGuidance" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTypeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "malwareScanStatus" "MalwareScanStatus" NOT NULL DEFAULT 'skipped',
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentTypeCode" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'needs_type_confirmation',
    "currentVersionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "readabilityStatus" "ReadabilityStatus" NOT NULL DEFAULT 'readable',
    "classificationStatus" "ClassificationStatus" NOT NULL DEFAULT 'pending',
    "confirmedTypeCode" TEXT,
    "classificationConfidence" DOUBLE PRECISION,
    "replacesVersionId" TEXT,
    "replacementReason" "ReplacementReason",
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPageReference" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "sourcePageNumber" INTEGER NOT NULL,
    "documentPageNumber" INTEGER NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "included" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DocumentPageReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTypeDefinition_schemeVersionId_idx" ON "DocumentTypeDefinition"("schemeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTypeDefinition_schemeVersionId_code_key" ON "DocumentTypeDefinition"("schemeVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFile_storageKey_key" ON "SourceFile"("storageKey");

-- CreateIndex
CREATE INDEX "SourceFile_caseId_idx" ON "SourceFile"("caseId");

-- CreateIndex
CREATE INDEX "SourceFile_providerId_idx" ON "SourceFile"("providerId");

-- CreateIndex
CREATE INDEX "SourceFile_contentHash_idx" ON "SourceFile"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "Document_caseId_idx" ON "Document"("caseId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_replacesVersionId_key" ON "DocumentVersion"("replacesVersionId");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_sourceFileId_idx" ON "DocumentVersion"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "DocumentPageReference_documentVersionId_idx" ON "DocumentPageReference"("documentVersionId");

-- CreateIndex
CREATE INDEX "DocumentPageReference_sourceFileId_idx" ON "DocumentPageReference"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPageReference_documentVersionId_documentPageNumber_key" ON "DocumentPageReference"("documentVersionId", "documentPageNumber");

-- AddForeignKey
ALTER TABLE "DocumentTypeDefinition" ADD CONSTRAINT "DocumentTypeDefinition_schemeVersionId_fkey" FOREIGN KEY ("schemeVersionId") REFERENCES "ValidationSchemeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "SourceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_replacesVersionId_fkey" FOREIGN KEY ("replacesVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPageReference" ADD CONSTRAINT "DocumentPageReference_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPageReference" ADD CONSTRAINT "DocumentPageReference_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "SourceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
