-- CreateEnum
CREATE TYPE "AcceptanceSource" AS ENUM ('client_admin', 'client_api');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('documentation_incomplete', 'information_inconsistent', 'not_eligible', 'duplicate_submission', 'outside_policy_period', 'service_not_covered', 'client_decision', 'other');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('created_by_mistake', 'duplicate_case', 'patient_withdrew', 'service_not_performed', 'submitted_elsewhere', 'other');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('missing_document', 'unreadable_document', 'incorrect_document', 'incorrect_information', 'validation_conflict', 'additional_information_required', 'other');

-- CreateEnum
CREATE TYPE "TransitionSource" AS ENUM ('provider_ui', 'client_ui', 'system', 'provider_api', 'client_api');

-- CreateEnum
CREATE TYPE "TransitionActorType" AS ENUM ('provider', 'client', 'system');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "acceptanceSource" "AcceptanceSource",
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedByUserId" TEXT,
ADD COLUMN     "cancellationNote" TEXT,
ADD COLUMN     "cancellationReason" "CancellationReason",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "externalLiquidationReference" TEXT,
ADD COLUMN     "liquidatedAt" TIMESTAMP(3),
ADD COLUMN     "liquidatedByUserId" TEXT,
ADD COLUMN     "liquidationSource" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByUserId" TEXT,
ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "rejectionReason" "RejectionReason",
ADD COLUMN     "statusBeforeArchive" "CaseStatus";

-- CreateTable
CREATE TABLE "CaseStatusHistory" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStatus" "CaseStatus",
    "toStatus" "CaseStatus" NOT NULL,
    "actorUserId" TEXT,
    "actorType" "TransitionActorType" NOT NULL,
    "reasonCode" TEXT,
    "reason" TEXT,
    "source" "TransitionSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseSubmission" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "validationRunId" TEXT NOT NULL,
    "documentVersionIds" JSONB NOT NULL DEFAULT '[]',
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseStatusHistory_caseId_idx" ON "CaseStatusHistory"("caseId");

-- CreateIndex
CREATE INDEX "CaseSubmission_caseId_idx" ON "CaseSubmission"("caseId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_liquidatedByUserId_fkey" FOREIGN KEY ("liquidatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStatusHistory" ADD CONSTRAINT "CaseStatusHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStatusHistory" ADD CONSTRAINT "CaseStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSubmission" ADD CONSTRAINT "CaseSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
