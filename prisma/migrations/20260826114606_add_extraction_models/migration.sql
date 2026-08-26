-- CreateEnum
CREATE TYPE "ClassificationMethod" AS ENUM ('provider_selected', 'metadata', 'filename', 'deterministic_text', 'specialized_model', 'generative_ai');

-- CreateEnum
CREATE TYPE "ExtractionValueType" AS ENUM ('string', 'date', 'number', 'money', 'boolean', 'identifier', 'code');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('embedded_text', 'deterministic_parser', 'ocr', 'specialized_model', 'generative_ai', 'provider_entered', 'client_reviewed');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('extracted', 'confirmed', 'corrected', 'absent', 'unreadable', 'low_confidence', 'inconsistent', 'invalid', 'failed');

-- CreateEnum
CREATE TYPE "ProcessingJobTask" AS ENUM ('read_text', 'ocr', 'classify', 'extract', 'normalize');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed', 'cancelled', 'superseded');

-- CreateTable
CREATE TABLE "ExtractionFieldDefinition" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "valueType" "ExtractionValueType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "normalization" JSONB NOT NULL DEFAULT '{}',
    "extractionHints" JSONB NOT NULL DEFAULT '[]',
    "validationDependencies" JSONB NOT NULL DEFAULT '[]',
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentClassificationResult" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "suggestedTypeCode" TEXT,
    "candidateTypes" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "evidenceReferences" JSONB NOT NULL DEFAULT '[]',
    "method" "ClassificationMethod" NOT NULL,
    "classifierName" TEXT,
    "classifierVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentClassificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrPageResult" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT,
    "confidence" DOUBLE PRECISION,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "ocrEngine" TEXT,
    "ocrEngineVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrPageResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "fieldDefinitionId" TEXT NOT NULL,
    "rawValue" TEXT,
    "normalizedValue" JSONB,
    "valueType" "ExtractionValueType" NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'extracted',
    "confidence" DOUBLE PRECISION,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "evidenceReferences" JSONB NOT NULL DEFAULT '[]',
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "extractorName" TEXT,
    "extractorVersion" TEXT,
    "confirmedValue" JSONB,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentProcessingJob" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "task" "ProcessingJobTask" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "inputVersionHash" TEXT NOT NULL,
    "processor" TEXT,
    "processorVersion" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtractionFieldDefinition_documentTypeId_idx" ON "ExtractionFieldDefinition"("documentTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionFieldDefinition_documentTypeId_code_key" ON "ExtractionFieldDefinition"("documentTypeId", "code");

-- CreateIndex
CREATE INDEX "DocumentClassificationResult_documentVersionId_idx" ON "DocumentClassificationResult"("documentVersionId");

-- CreateIndex
CREATE INDEX "OcrPageResult_documentVersionId_idx" ON "OcrPageResult"("documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "OcrPageResult_documentVersionId_pageNumber_key" ON "OcrPageResult"("documentVersionId", "pageNumber");

-- CreateIndex
CREATE INDEX "ExtractedField_caseId_idx" ON "ExtractedField"("caseId");

-- CreateIndex
CREATE INDEX "ExtractedField_documentId_idx" ON "ExtractedField"("documentId");

-- CreateIndex
CREATE INDEX "ExtractedField_documentVersionId_idx" ON "ExtractedField"("documentVersionId");

-- CreateIndex
CREATE INDEX "ExtractedField_fieldDefinitionId_idx" ON "ExtractedField"("fieldDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedField_documentVersionId_fieldDefinitionId_key" ON "ExtractedField"("documentVersionId", "fieldDefinitionId");

-- CreateIndex
CREATE INDEX "DocumentProcessingJob_documentVersionId_idx" ON "DocumentProcessingJob"("documentVersionId");

-- CreateIndex
CREATE INDEX "DocumentProcessingJob_status_idx" ON "DocumentProcessingJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentProcessingJob_documentVersionId_task_inputVersionHa_key" ON "DocumentProcessingJob"("documentVersionId", "task", "inputVersionHash");

-- AddForeignKey
ALTER TABLE "ExtractionFieldDefinition" ADD CONSTRAINT "ExtractionFieldDefinition_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentClassificationResult" ADD CONSTRAINT "DocumentClassificationResult_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrPageResult" ADD CONSTRAINT "OcrPageResult_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_fieldDefinitionId_fkey" FOREIGN KEY ("fieldDefinitionId") REFERENCES "ExtractionFieldDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProcessingJob" ADD CONSTRAINT "DocumentProcessingJob_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
