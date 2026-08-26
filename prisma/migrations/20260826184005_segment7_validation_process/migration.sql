-- CreateEnum
CREATE TYPE "ValidationRunStatus" AS ENUM ('queued', 'processing', 'waiting_for_provider', 'waiting_for_client_review', 'completed', 'partially_completed', 'failed', 'cancelled', 'superseded');

-- CreateEnum
CREATE TYPE "ValidationTrigger" AS ENUM ('provider_started', 'automatic_after_upload', 'automatic_after_confirmation', 'provider_revalidated', 'client_requested_revalidation', 'system_retry');

-- CreateEnum
CREATE TYPE "OverallValidationResult" AS ENUM ('passed', 'passed_with_warnings', 'issues_found', 'needs_provider_action', 'needs_client_review', 'incomplete', 'processing_failed');

-- CreateEnum
CREATE TYPE "RuleOutcome" AS ENUM ('pass', 'fail', 'needs_review', 'skipped', 'not_executed', 'processing_error');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('document', 'field', 'readability', 'classification', 'split_confirmation');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('satisfied', 'missing', 'unreadable', 'unconfirmed', 'invalid');

-- CreateEnum
CREATE TYPE "RecommendationCode" AS ENUM ('upload_medical_report', 'upload_clearer_invoice', 'confirm_document_type', 'review_patient_name', 'review_event_date', 'confirm_policy_period', 'request_client_review', 'contact_insurer');

-- CreateEnum
CREATE TYPE "TechnicalErrorCode" AS ENUM ('rule_engine_error', 'model_timeout', 'invalid_model_output', 'evidence_unavailable', 'dependency_unavailable', 'budget_exceeded', 'processing_job_failed');

-- CreateEnum
CREATE TYPE "HitlStatus" AS ENUM ('open', 'in_review', 'waiting_for_provider', 'resolved', 'cancelled', 'superseded');

-- CreateEnum
CREATE TYPE "HitlDecisionType" AS ENUM ('confirm', 'override_to_pass', 'override_to_fail', 'request_documents', 'return_to_provider');

-- CreateTable
CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "schemeVersionId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "status" "ValidationRunStatus" NOT NULL DEFAULT 'queued',
    "overallResult" "OverallValidationResult",
    "trigger" "ValidationTrigger" NOT NULL,
    "startedByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "inputSnapshotHash" TEXT NOT NULL,
    "compiledPlanVersion" INTEGER NOT NULL DEFAULT 1,
    "casePinnedVersion" INTEGER NOT NULL,
    "aiModelId" TEXT,
    "aiPromptVersion" TEXT,
    "supersedesValidationRunId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRuleResult" (
    "id" TEXT NOT NULL,
    "validationRunId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "schemeRuleId" TEXT,
    "outcome" "RuleOutcome" NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "recommendationCode" "RecommendationCode",
    "technicalErrorCode" "TechnicalErrorCode",
    "inputReferences" JSONB NOT NULL DEFAULT '[]',
    "evidenceReferences" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "inputSubsetHash" TEXT NOT NULL,
    "executionType" "RuleExecutionType" NOT NULL,
    "executionEngine" TEXT NOT NULL,
    "executionEngineVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "superseded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ValidationRuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementResult" (
    "id" TEXT NOT NULL,
    "validationRunId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "requirementType" "RequirementType" NOT NULL,
    "documentTypeCode" TEXT,
    "fieldDefinitionId" TEXT,
    "status" "RequirementStatus" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "recommendationCode" "RecommendationCode",
    "superseded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RequirementResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HitlTask" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "validationRunId" TEXT NOT NULL,
    "ruleResultId" TEXT NOT NULL,
    "assignedClientId" TEXT NOT NULL,
    "status" "HitlStatus" NOT NULL DEFAULT 'open',
    "reasonCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededByHitlTaskId" TEXT,

    CONSTRAINT "HitlTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HitlDecision" (
    "id" TEXT NOT NULL,
    "hitlTaskId" TEXT NOT NULL,
    "automatedOutcome" "RuleOutcome" NOT NULL,
    "decision" "HitlDecisionType" NOT NULL,
    "reasonCode" TEXT,
    "reason" TEXT,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HitlDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ValidationRun_supersedesValidationRunId_key" ON "ValidationRun"("supersedesValidationRunId");

-- CreateIndex
CREATE INDEX "ValidationRun_caseId_idx" ON "ValidationRun"("caseId");

-- CreateIndex
CREATE INDEX "ValidationRun_schemeVersionId_idx" ON "ValidationRun"("schemeVersionId");

-- CreateIndex
CREATE INDEX "ValidationRun_status_idx" ON "ValidationRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationRun_caseId_runNumber_key" ON "ValidationRun"("caseId", "runNumber");

-- CreateIndex
CREATE INDEX "ValidationRuleResult_validationRunId_idx" ON "ValidationRuleResult"("validationRunId");

-- CreateIndex
CREATE INDEX "ValidationRuleResult_caseId_idx" ON "ValidationRuleResult"("caseId");

-- CreateIndex
CREATE INDEX "ValidationRuleResult_ruleVersionId_idx" ON "ValidationRuleResult"("ruleVersionId");

-- CreateIndex
CREATE INDEX "RequirementResult_validationRunId_idx" ON "RequirementResult"("validationRunId");

-- CreateIndex
CREATE INDEX "RequirementResult_caseId_idx" ON "RequirementResult"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "HitlTask_ruleResultId_key" ON "HitlTask"("ruleResultId");

-- CreateIndex
CREATE UNIQUE INDEX "HitlTask_supersededByHitlTaskId_key" ON "HitlTask"("supersededByHitlTaskId");

-- CreateIndex
CREATE INDEX "HitlTask_caseId_idx" ON "HitlTask"("caseId");

-- CreateIndex
CREATE INDEX "HitlTask_validationRunId_idx" ON "HitlTask"("validationRunId");

-- CreateIndex
CREATE INDEX "HitlTask_assignedClientId_idx" ON "HitlTask"("assignedClientId");

-- CreateIndex
CREATE INDEX "HitlTask_status_idx" ON "HitlTask"("status");

-- CreateIndex
CREATE INDEX "HitlDecision_hitlTaskId_idx" ON "HitlDecision"("hitlTaskId");

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_schemeVersionId_fkey" FOREIGN KEY ("schemeVersionId") REFERENCES "ValidationSchemeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_supersedesValidationRunId_fkey" FOREIGN KEY ("supersedesValidationRunId") REFERENCES "ValidationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRuleResult" ADD CONSTRAINT "ValidationRuleResult_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRuleResult" ADD CONSTRAINT "ValidationRuleResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRuleResult" ADD CONSTRAINT "ValidationRuleResult_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "ValidationRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRuleResult" ADD CONSTRAINT "ValidationRuleResult_schemeRuleId_fkey" FOREIGN KEY ("schemeRuleId") REFERENCES "ValidationSchemeRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementResult" ADD CONSTRAINT "RequirementResult_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementResult" ADD CONSTRAINT "RequirementResult_fieldDefinitionId_fkey" FOREIGN KEY ("fieldDefinitionId") REFERENCES "ExtractionFieldDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_ruleResultId_fkey" FOREIGN KEY ("ruleResultId") REFERENCES "ValidationRuleResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_assignedClientId_fkey" FOREIGN KEY ("assignedClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_supersededByHitlTaskId_fkey" FOREIGN KEY ("supersededByHitlTaskId") REFERENCES "HitlTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlDecision" ADD CONSTRAINT "HitlDecision_hitlTaskId_fkey" FOREIGN KEY ("hitlTaskId") REFERENCES "HitlTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HitlDecision" ADD CONSTRAINT "HitlDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

