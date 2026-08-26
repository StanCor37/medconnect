import type { Prisma } from "@/generated/prisma/client";
import type { RuleOutcome, RuleSeverity, RuleExecutionType, RecommendationCode, TechnicalErrorCode } from "@/generated/prisma/enums";
import { evaluateDeterministicRule } from "@/lib/rules/evaluateDeterministicRule";
import { deterministicRuleDefinitionSchema } from "@/lib/validation/rule";
import type { ResolvedValidationInput } from "@/lib/validation/engine/resolvedInput";
import type { RequirementResultDraft } from "@/lib/validation/engine/requirements";
import { extractFieldPathsFromDefinition, hashInputSubset } from "@/lib/validation/engine/inputHashing";
import { recommendationForRuleFailure } from "@/lib/validation/engine/recommendations";

export const DETERMINISTIC_ENGINE = "deterministic_v1";

type SchemeRuleWithVersion = Prisma.ValidationSchemeRuleGetPayload<{
  include: { ruleVersion: { include: { rule: true } } };
}>;

export interface RuleResultDraft {
  schemeRuleId: string;
  ruleVersionId: string;
  outcome: RuleOutcome;
  severity: RuleSeverity;
  reasonCode: string;
  recommendationCode: RecommendationCode | null;
  technicalErrorCode: TechnicalErrorCode | null;
  confidence: number | null;
  evidenceReferences: unknown[];
  inputSubsetHash: string;
  executionType: RuleExecutionType;
  executionEngine: string;
  executionEngineVersion: string;
  cached: boolean;
}

/** Prior completed run's result for one ruleVersionId — the selective-revalidation comparison key. */
export interface PriorRuleResult {
  ruleVersionId: string;
  inputSubsetHash: string;
  outcome: RuleOutcome;
  reasonCode: string;
  recommendationCode: RecommendationCode | null;
  technicalErrorCode: TechnicalErrorCode | null;
  confidence: number | null;
  evidenceReferences: unknown[];
}

/**
 * A resolveFieldPath miss (evaluateDeterministicRule's "skipped") means one
 * of two different things depending on WHY the path is missing — this is
 * what distinguishes RuleOutcome "not_executed" (the input SHOULD exist per
 * this Scheme's own required Document/field set, but doesn't yet) from
 * "skipped" (the rule genuinely doesn't apply — e.g. references a Document
 * Type this Scheme doesn't even define, or an optional field nobody filled
 * in). Cross-checks against the RequirementResults already computed rather
 * than re-deriving the same fact twice.
 */
function classifyUnresolvedPath(reasonCode: string, requirements: RequirementResultDraft[]): RuleOutcome {
  const path = reasonCode.startsWith("field_path_not_found:") ? reasonCode.slice("field_path_not_found:".length) : null;
  if (!path) return "skipped";

  if (path.startsWith("documents.")) {
    const code = path.slice("documents.".length);
    const req = requirements.find((r) => r.requirementType === "document" && r.documentTypeCode === code);
    return req && req.status !== "satisfied" ? "not_executed" : "skipped";
  }
  if (path.startsWith("fields.")) {
    const [, docTypeCode] = path.split(".");
    const req = requirements.find((r) => r.requirementType === "field" && r.documentTypeCode === docTypeCode);
    return req && req.status !== "satisfied" ? "not_executed" : "skipped";
  }
  return "skipped";
}

/** Iterates ValidationSchemeRules in executionOrder, deterministic ones only — spec §6 steps 1-6. */
export function runDeterministicPhase(
  schemeRules: SchemeRuleWithVersion[],
  resolvedInput: ResolvedValidationInput,
  requirements: RequirementResultDraft[],
  priorResultsByRuleVersionId: Map<string, PriorRuleResult>
): RuleResultDraft[] {
  const deterministicRules = schemeRules
    .filter((sr) => sr.enabled && sr.ruleVersion.rule.executionType === "deterministic")
    .sort((a, b) => a.executionOrder - b.executionOrder);

  return deterministicRules.map((schemeRule) => {
    const parsed = deterministicRuleDefinitionSchema.safeParse(schemeRule.ruleVersion.definition);
    const inputSubsetHash = parsed.success ? hashInputSubset(resolvedInput, extractFieldPathsFromDefinition(parsed.data)) : "invalid";

    // Cheap to just re-run a deterministic rule regardless (no external
    // cost) — but still flag `cached` when the result provably didn't need
    // to change, satisfying "unchanged results are reused safely" alongside
    // the AI phase's genuine skip-before-calling behavior.
    const prior = priorResultsByRuleVersionId.get(schemeRule.ruleVersionId);
    const canReuse = prior && prior.inputSubsetHash === inputSubsetHash;

    if (!parsed.success) {
      return {
        schemeRuleId: schemeRule.id,
        ruleVersionId: schemeRule.ruleVersionId,
        outcome: "processing_error",
        severity: schemeRule.ruleVersion.severity,
        reasonCode: "invalid_rule_definition",
        recommendationCode: null,
        technicalErrorCode: null,
        confidence: null,
        evidenceReferences: [],
        inputSubsetHash,
        executionType: "deterministic",
        executionEngine: DETERMINISTIC_ENGINE,
        executionEngineVersion: "1",
        cached: false,
      };
    }

    if (canReuse) {
      return {
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
        executionType: "deterministic",
        executionEngine: DETERMINISTIC_ENGINE,
        executionEngineVersion: "1",
        cached: true,
      };
    }

    // Per-pairing parameter overrides merge OVER the rule version's own
    // definition.parameters (see ValidationSchemeRule.parameters' own
    // schema comment) — never the reverse, so a Scheme author can tune a
    // shared global Rule's thresholds per-pairing without a new Rule version.
    const mergedDefinition = {
      ...parsed.data,
      parameters: { ...parsed.data.parameters, ...(schemeRule.parameters as Record<string, unknown>) },
    } as typeof parsed.data;

    const evaluated = evaluateDeterministicRule(mergedDefinition, resolvedInput as unknown as Record<string, unknown>);
    const outcome: RuleOutcome = evaluated.outcome === "skipped" ? classifyUnresolvedPath(evaluated.reasonCode, requirements) : evaluated.outcome;

    return {
      schemeRuleId: schemeRule.id,
      ruleVersionId: schemeRule.ruleVersionId,
      outcome,
      severity: schemeRule.ruleVersion.severity,
      reasonCode: evaluated.reasonCode,
      recommendationCode: outcome === "fail" ? recommendationForRuleFailure(schemeRule.ruleVersion.rule.category, evaluated.reasonCode) : null,
      technicalErrorCode: null,
      confidence: null,
      evidenceReferences: [],
      inputSubsetHash,
      executionType: "deterministic",
      executionEngine: DETERMINISTIC_ENGINE,
      executionEngineVersion: "1",
      cached: false,
    };
  });
}
