import type { Prisma } from "@/generated/prisma/client";
import type { RuleOutcome, RuleSeverity, RecommendationCode, TechnicalErrorCode } from "@/generated/prisma/enums";
import { aiRuleDefinitionSchema } from "@/lib/validation/rule";
import type { AiRuleEvaluator } from "@/lib/ai/aiRuleEvaluator";
import { AiRuleEvaluatorError } from "@/lib/ai/aiRuleEvaluator";
import { evaluateApplicabilityGate } from "@/lib/validation/engine/applicabilityGate";
import type { ResolvedValidationInput } from "@/lib/validation/engine/resolvedInput";
import { extractFieldPathsFromGate, hashInputSubset } from "@/lib/validation/engine/inputHashing";
import { recommendationForRuleFailure } from "@/lib/validation/engine/recommendations";
import type { RuleResultDraft, PriorRuleResult } from "@/lib/validation/engine/deterministicPhase";

export const AI_ENGINE = "claude_ai_rule_evaluator";
const DEFAULT_AI_RULE_CALL_BUDGET = 5;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;

type SchemeRuleWithVersion = Prisma.ValidationSchemeRuleGetPayload<{
  include: { ruleVersion: { include: { rule: true } } };
}>;
type DocumentWithVersion = Prisma.DocumentGetPayload<{ include: { currentVersion: true } }>;

export interface AiPhaseResult extends RuleResultDraft {
  aiModelId: string | null;
}

function getAiCallBudget(): number {
  const raw = process.env.AI_RULE_CALL_BUDGET;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_AI_RULE_CALL_BUDGET;
}

function getLowConfidenceThreshold(): number {
  const raw = process.env.AI_LOW_CONFIDENCE_HITL_THRESHOLD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_LOW_CONFIDENCE_THRESHOLD;
}

/** spec §6 steps 7-8: applicability gates run first (no API call), AI only for rules that pass. */
export async function runAiPhase(
  tx: Prisma.TransactionClient,
  schemeRules: SchemeRuleWithVersion[],
  documents: DocumentWithVersion[],
  resolvedInput: ResolvedValidationInput,
  aiRuleEvaluator: AiRuleEvaluator,
  priorResultsByRuleVersionId: Map<string, PriorRuleResult>
): Promise<{ results: AiPhaseResult[]; aiModelId: string | null }> {
  const aiRules = schemeRules
    .filter((sr) => sr.enabled && sr.ruleVersion.rule.executionType === "ai_assisted")
    .sort((a, b) => a.executionOrder - b.executionOrder);

  const results: AiPhaseResult[] = [];
  let remainingBudget = getAiCallBudget();
  let aiModelId: string | null = null;
  const lowConfidenceThreshold = getLowConfidenceThreshold();

  const latestByType = new Map<string, DocumentWithVersion>();
  for (const doc of documents.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (doc.documentTypeCode && doc.currentVersionId) latestByType.set(doc.documentTypeCode, doc);
  }

  for (const schemeRule of aiRules) {
    const parsed = aiRuleDefinitionSchema.safeParse(schemeRule.ruleVersion.definition);
    if (!parsed.success) {
      results.push(makeResult(schemeRule, "processing_error", schemeRule.ruleVersion.severity, "invalid_rule_definition", "rule_engine_error", null, null, []));
      continue;
    }
    const definition = parsed.data;
    const inputSubsetHash = hashInputSubset(resolvedInput, extractFieldPathsFromGate(definition.applicabilityGate));

    // Checked BEFORE the gate and BEFORE any API call — this is what makes
    // "never duplicate AI cost for identical inputs" actually true, not
    // just true-after-the-fact. An unchanged applicability-gate subset
    // means Claude would necessarily be asked the exact same question
    // against the exact same evidence again.
    const prior = priorResultsByRuleVersionId.get(schemeRule.ruleVersionId);
    if (prior && prior.inputSubsetHash === inputSubsetHash) {
      results.push({
        schemeRuleId: schemeRule.id,
        ruleVersionId: schemeRule.ruleVersionId,
        outcome: prior.outcome,
        severity: schemeRule.ruleVersion.severity,
        reasonCode: prior.reasonCode,
        recommendationCode: prior.recommendationCode,
        technicalErrorCode: prior.technicalErrorCode,
        confidence: prior.confidence,
        evidenceReferences: prior.evidenceReferences,
        inputSubsetHash,
        executionType: "ai_assisted",
        executionEngine: AI_ENGINE,
        executionEngineVersion: "1",
        cached: true,
        aiModelId: null,
      });
      continue;
    }

    const gate = evaluateApplicabilityGate(definition.applicabilityGate, resolvedInput);
    if (!gate.applicable) {
      results.push(makeResult(schemeRule, "skipped", schemeRule.ruleVersion.severity, gate.reasonCode, null, null, inputSubsetHash, []));
      continue;
    }

    if (remainingBudget <= 0) {
      results.push(makeResult(schemeRule, "processing_error", schemeRule.ruleVersion.severity, "ai_call_budget_exceeded", "budget_exceeded", null, inputSubsetHash, []));
      continue;
    }

    const evidenceText = await gatherEvidenceText(tx, definition.applicabilityGate.requiredDocumentTypes, latestByType);
    remainingBudget -= 1;
    try {
      const evaluated = await aiRuleEvaluator.evaluate({
        ruleVersionId: schemeRule.ruleVersionId,
        evaluationQuestion: definition.evaluationQuestion,
        evidenceRequirements: definition.evidenceRequirements,
        evidenceText,
      });
      aiModelId = evaluated.modelId;

      let outcome: RuleOutcome = evaluated.outcome;
      let reasonCode =
        evaluated.outcome === "pass"
          ? "ai_condition_satisfied"
          : evaluated.outcome === "fail"
            ? "ai_condition_not_satisfied"
            : "ai_needs_human_judgment";
      if (outcome === "pass" && evaluated.confidence < lowConfidenceThreshold) {
        outcome = "needs_review";
        reasonCode = "ai_low_confidence";
      }

      // Drop any evidence reference to a Document Version that isn't
      // actually part of this Case's own resolved input — defense against
      // a hallucinated id (spec §13: never trust raw model output at face value).
      const validVersionIds = new Set(Array.from(latestByType.values()).map((d) => d.currentVersionId));
      const evidenceReferences = evaluated.evidence.filter((e) => validVersionIds.has(e.documentVersionId));

      results.push(
        makeResult(
          schemeRule,
          outcome,
          schemeRule.ruleVersion.severity,
          reasonCode,
          null,
          outcome === "fail" ? recommendationForRuleFailure(schemeRule.ruleVersion.rule.category, reasonCode) : null,
          inputSubsetHash,
          evidenceReferences,
          evaluated.confidence
        )
      );
    } catch (err) {
      const technicalErrorCode = err instanceof AiRuleEvaluatorError ? err.code : "rule_engine_error";
      results.push(makeResult(schemeRule, "processing_error", schemeRule.ruleVersion.severity, technicalErrorCode, technicalErrorCode, null, inputSubsetHash, []));
    }
  }

  return { results, aiModelId };
}

async function gatherEvidenceText(
  tx: Prisma.TransactionClient,
  requiredDocumentTypes: string[],
  latestByType: Map<string, DocumentWithVersion>
): Promise<{ documentVersionId: string; documentTypeCode: string; pageNumber: number; text: string }[]> {
  const evidence: { documentVersionId: string; documentTypeCode: string; pageNumber: number; text: string }[] = [];
  for (const code of requiredDocumentTypes) {
    const doc = latestByType.get(code);
    if (!doc?.currentVersionId) continue;
    const pages = await tx.ocrPageResult.findMany({
      where: { documentVersionId: doc.currentVersionId },
      orderBy: { pageNumber: "asc" },
    });
    for (const page of pages) {
      if (page.text.trim()) evidence.push({ documentVersionId: doc.currentVersionId, documentTypeCode: code, pageNumber: page.pageNumber, text: page.text });
    }
  }
  return evidence;
}

function makeResult(
  schemeRule: SchemeRuleWithVersion,
  outcome: RuleOutcome,
  severity: RuleSeverity,
  reasonCode: string,
  technicalErrorCode: TechnicalErrorCode | null,
  recommendationCode: RecommendationCode | null,
  inputSubsetHash: string | null,
  evidenceReferences: unknown[],
  confidence: number | null = null
): AiPhaseResult {
  return {
    schemeRuleId: schemeRule.id,
    ruleVersionId: schemeRule.ruleVersionId,
    outcome,
    severity,
    reasonCode,
    recommendationCode,
    technicalErrorCode,
    confidence,
    evidenceReferences,
    inputSubsetHash: inputSubsetHash ?? "unavailable",
    executionType: "ai_assisted",
    executionEngine: AI_ENGINE,
    executionEngineVersion: "1",
    cached: false,
    aiModelId: null,
  };
}
