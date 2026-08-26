import { Prisma } from "@/generated/prisma/client";
import type { ValidationTrigger } from "@/generated/prisma/enums";
import type { AuthContext } from "@/lib/authz/can";
import { writeAuditEvent } from "@/lib/audit/record";
import { getDefaultAiRuleEvaluator } from "@/lib/ai/claudeAiRuleEvaluator";
import type { AiRuleEvaluator } from "@/lib/ai/aiRuleEvaluator";
import { buildResolvedInput } from "@/lib/validation/engine/resolvedInput";
import { hashResolvedInput } from "@/lib/validation/engine/inputHashing";
import { evaluateRequirements } from "@/lib/validation/engine/requirements";
import { runDeterministicPhase, type PriorRuleResult, type RuleResultDraft } from "@/lib/validation/engine/deterministicPhase";
import { runAiPhase } from "@/lib/validation/engine/aiPhase";
import { computeOverallValidationResult } from "@/lib/validation/engine/overallResult";
import { shouldCreateHitlTask } from "@/lib/validation/engine/hitl";

export class ValidationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function validationErrorStatus(code: string): number {
  switch (code) {
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "no_scheme_assigned":
      return 409;
    case "invalid_state":
      return 409;
    case "stale_version":
      return 409;
    default:
      return 400;
  }
}

export interface StartValidationRunDeps {
  aiRuleEvaluator?: AiRuleEvaluator;
}

/**
 * Orchestrates spec §6's 12-step pipeline end-to-end inside one transaction
 * (see the plan's §0.1 framing note on why AI calls run inline here, same
 * as OCR does today). Never touches Case.status (spec §27 — a different
 * segment's job).
 */
export async function startValidationRunService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  trigger: ValidationTrigger,
  deps: StartValidationRunDeps = {}
) {
  const aiRuleEvaluator = deps.aiRuleEvaluator ?? getDefaultAiRuleEvaluator();

  const caseRow = await tx.case.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new ValidationServiceError("not_found", "Case not found");
  if (caseRow.archivedAt) throw new ValidationServiceError("invalid_state", "Cannot validate an archived Case");
  if (!caseRow.validationSchemeVersionId) {
    throw new ValidationServiceError("no_scheme_assigned", "Assign a Validation Scheme to this Case before validating");
  }

  const schemeVersion = await tx.validationSchemeVersion.findUniqueOrThrow({
    where: { id: caseRow.validationSchemeVersionId },
    include: {
      documentTypeDefinitions: { include: { extractionFieldDefinitions: true } },
      schemeRules: { include: { ruleVersion: { include: { rule: true } } } },
    },
  });

  const documents = await tx.document.findMany({
    where: { caseId, archivedAt: null },
    include: { currentVersion: true },
  });

  const resolvedInput = await buildResolvedInput(tx, caseRow);
  const inputSnapshotHash = hashResolvedInput(resolvedInput);

  // The current (non-superseded) run for this Case, if any — the
  // selective-revalidation comparison base. Only a completed/
  // partially_completed run's results are trustworthy to reuse.
  const priorRun = await tx.validationRun.findFirst({
    where: { caseId, status: { in: ["completed", "partially_completed"] } },
    orderBy: { runNumber: "desc" },
    include: { ruleResults: true },
  });
  const runNumber = (priorRun?.runNumber ?? 0) + 1;

  const priorResultsByRuleVersionId = new Map<string, PriorRuleResult>();
  for (const r of priorRun?.ruleResults ?? []) {
    priorResultsByRuleVersionId.set(r.ruleVersionId, {
      ruleVersionId: r.ruleVersionId,
      inputSubsetHash: r.inputSubsetHash,
      outcome: r.outcome,
      reasonCode: r.reasonCode,
      recommendationCode: r.recommendationCode,
      technicalErrorCode: r.technicalErrorCode,
      confidence: r.confidence,
      evidenceReferences: r.evidenceReferences as unknown[],
    });
  }

  const requirementDrafts = await evaluateRequirements(tx, caseId, schemeVersion, documents);
  const deterministicDrafts = runDeterministicPhase(schemeVersion.schemeRules, resolvedInput, requirementDrafts, priorResultsByRuleVersionId);
  const { results: aiDrafts, aiModelId } = await runAiPhase(
    tx,
    schemeVersion.schemeRules,
    documents,
    resolvedInput,
    aiRuleEvaluator,
    priorResultsByRuleVersionId
  );
  const allRuleDrafts: RuleResultDraft[] = [...deterministicDrafts, ...aiDrafts];

  const schemeRuleById = new Map(schemeVersion.schemeRules.map((sr) => [sr.id, sr]));
  // spec §29 "Client HITL requires Client association and active
  // relationship" — enforced at creation time, not just at decide-time
  // (scopedHitlTaskWhere's own re-check is the OTHER half of this
  // guarantee, for a relationship that goes inactive after the task exists).
  const relationship = caseRow.providerClientRelationshipId
    ? await tx.providerClientRelationship.findUnique({ where: { id: caseRow.providerClientRelationshipId } })
    : null;
  const hitlEligible = caseRow.caseMode === "client_connected" && caseRow.clientId !== null && relationship?.status === "active";
  const draftsNeedingHitl = allRuleDrafts.filter((draft) => {
    if (!hitlEligible) return false;
    const schemeRule = schemeRuleById.get(draft.schemeRuleId);
    if (!schemeRule) return false;
    const hitlPolicy = schemeRule.hitlPolicyOverride ?? schemeRule.ruleVersion.hitlPolicy;
    return shouldCreateHitlTask(draft.outcome, hitlPolicy);
  });

  const overallResult = computeOverallValidationResult({
    requirements: requirementDrafts,
    ruleResults: allRuleDrafts,
    openHitlTaskCount: draftsNeedingHitl.length,
    caseMode: caseRow.caseMode,
  });
  const hasProcessingError = allRuleDrafts.some((r) => r.outcome === "processing_error");
  const runStatus = hasProcessingError ? "partially_completed" : "completed";

  // "provider_started" is what every Provider-initiated call passes — this
  // upgrades it to "provider_revalidated" whenever a prior run already
  // exists, without the caller needing to know the Case's history first.
  const effectiveTrigger = trigger === "provider_started" && priorRun ? "provider_revalidated" : trigger;

  const run = await tx.validationRun.create({
    data: {
      caseId,
      schemeVersionId: schemeVersion.id,
      runNumber,
      status: runStatus,
      overallResult,
      trigger: effectiveTrigger,
      startedByUserId: actor.userId,
      completedAt: new Date(),
      inputSnapshotHash,
      casePinnedVersion: caseRow.version,
      aiModelId,
      aiPromptVersion: aiModelId ? "v1" : null,
      supersedesValidationRunId: priorRun?.id ?? null,
    },
  });

  if (requirementDrafts.length > 0) {
    await tx.requirementResult.createMany({
      data: requirementDrafts.map((r) => ({
        validationRunId: run.id,
        caseId,
        requirementType: r.requirementType,
        documentTypeCode: r.documentTypeCode,
        fieldDefinitionId: r.fieldDefinitionId,
        status: r.status,
        reasonCode: r.reasonCode,
        recommendationCode: r.recommendationCode ?? undefined,
      })),
    });
  }

  const createdRuleResultByDraft = new Map<RuleResultDraft, { id: string }>();
  for (const draft of allRuleDrafts) {
    const created = await tx.validationRuleResult.create({
      data: {
        validationRunId: run.id,
        caseId,
        ruleVersionId: draft.ruleVersionId,
        schemeRuleId: draft.schemeRuleId,
        outcome: draft.outcome,
        severity: draft.severity,
        reasonCode: draft.reasonCode,
        recommendationCode: draft.recommendationCode ?? undefined,
        technicalErrorCode: draft.technicalErrorCode ?? undefined,
        inputReferences: [],
        evidenceReferences: draft.evidenceReferences as Prisma.InputJsonValue,
        confidence: draft.confidence,
        inputSubsetHash: draft.inputSubsetHash,
        executionType: draft.executionType,
        executionEngine: draft.executionEngine,
        executionEngineVersion: draft.executionEngineVersion,
        startedAt: run.startedAt,
        completedAt: new Date(),
        cached: draft.cached,
      },
    });
    createdRuleResultByDraft.set(draft, created);

    await writeAuditEvent(tx, {
      eventType: draft.cached ? "rule_result_reused" : "rule_executed",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: caseRow.providerId,
      clientId: caseRow.clientId,
      caseId,
      targetType: "ValidationRuleResult",
      targetId: created.id,
      action: draft.cached ? "reuse" : "execute",
      source: "api",
      reasonCode: draft.reasonCode,
    });
  }

  for (const draft of draftsNeedingHitl) {
    const ruleResultRow = createdRuleResultByDraft.get(draft)!;
    const createdTask = await tx.hitlTask.create({
      data: {
        caseId,
        validationRunId: run.id,
        ruleResultId: ruleResultRow.id,
        assignedClientId: caseRow.clientId!,
        status: "open",
        reasonCode: draft.reasonCode,
      },
    });
    await writeAuditEvent(tx, {
      eventType: "hitl_started",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: caseRow.providerId,
      clientId: caseRow.clientId,
      caseId,
      targetType: "HitlTask",
      targetId: createdTask.id,
      action: "create",
      source: "api",
      reasonCode: draft.reasonCode,
    });
  }

  if (priorRun) {
    await tx.validationRuleResult.updateMany({ where: { validationRunId: priorRun.id }, data: { superseded: true } });
    await tx.requirementResult.updateMany({ where: { validationRunId: priorRun.id }, data: { superseded: true } });
    await tx.validationRun.update({ where: { id: priorRun.id }, data: { status: "superseded" } });
    await writeAuditEvent(tx, {
      eventType: "validation_superseded",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: caseRow.providerId,
      clientId: caseRow.clientId,
      caseId,
      targetType: "ValidationRun",
      targetId: priorRun.id,
      action: "supersede",
      source: "api",
    });
  }

  await writeAuditEvent(tx, {
    eventType: priorRun ? "revalidation_started" : "validation_started",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: caseRow.providerId,
    clientId: caseRow.clientId,
    caseId,
    targetType: "ValidationRun",
    targetId: run.id,
    action: "start",
    source: "api",
    reasonCode: trigger,
  });
  await writeAuditEvent(tx, {
    eventType: runStatus === "completed" ? "validation_completed" : "validation_partially_completed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: caseRow.providerId,
    clientId: caseRow.clientId,
    caseId,
    targetType: "ValidationRun",
    targetId: run.id,
    action: "complete",
    source: "api",
  });
  if (hitlEligible && draftsNeedingHitl.length > 0) {
    await writeAuditEvent(tx, {
      eventType: "client_review_requested",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: caseRow.providerId,
      clientId: caseRow.clientId,
      caseId,
      targetType: "Case",
      targetId: caseId,
      action: "request_review",
      source: "api",
    });
  } else if (overallResult === "needs_provider_action") {
    await writeAuditEvent(tx, {
      eventType: "provider_action_requested",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: caseRow.providerId,
      clientId: caseRow.clientId,
      caseId,
      targetType: "Case",
      targetId: caseId,
      action: "request_action",
      source: "api",
    });
  }

  return tx.validationRun.findUniqueOrThrow({
    where: { id: run.id },
    include: {
      requirementResults: true,
      ruleResults: { include: { ruleVersion: true, hitlTask: true } },
      hitlTasks: true,
    },
  });
}
