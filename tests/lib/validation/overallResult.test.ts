import { describe, it, expect } from "vitest";
import { computeOverallValidationResult } from "@/lib/validation/engine/overallResult";
import type { RequirementResultDraft } from "@/lib/validation/engine/requirements";
import type { RuleResultDraft } from "@/lib/validation/engine/deterministicPhase";

function requirement(status: RequirementResultDraft["status"]): RequirementResultDraft {
  return { requirementType: "document", documentTypeCode: "invoice", fieldDefinitionId: null, status, reasonCode: "test", recommendationCode: null };
}
function rule(outcome: RuleResultDraft["outcome"], severity: RuleResultDraft["severity"] = "blocking"): RuleResultDraft {
  return {
    schemeRuleId: "sr1",
    ruleVersionId: "rv1",
    outcome,
    severity,
    reasonCode: "test",
    recommendationCode: null,
    technicalErrorCode: outcome === "processing_error" ? "rule_engine_error" : null,
    confidence: null,
    evidenceReferences: [],
    inputSubsetHash: "h",
    executionType: "deterministic",
    executionEngine: "deterministic_v1",
    executionEngineVersion: "1",
    cached: false,
  };
}

describe("computeOverallValidationResult — pure, spec §10/§32", () => {
  it("passed — no requirements missing, no rule issues", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("pass")], openHitlTaskCount: 0, caseMode: "standalone" })).toBe("passed");
  });

  it("incomplete beats everything else — missing requirement", () => {
    const result = computeOverallValidationResult({
      requirements: [requirement("missing")],
      ruleResults: [rule("processing_error"), rule("fail")],
      openHitlTaskCount: 5,
      caseMode: "client_connected",
    });
    expect(result).toBe("incomplete");
  });

  it("incomplete for an unreadable requirement too", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("unreadable")], ruleResults: [], openHitlTaskCount: 0, caseMode: "standalone" })).toBe("incomplete");
  });

  it("needs_provider_action — unconfirmed requirement", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("unconfirmed")], ruleResults: [], openHitlTaskCount: 0, caseMode: "client_connected" })).toBe("needs_provider_action");
  });

  it("needs_provider_action — standalone Case with a blocking needs_review (no Client to route to)", () => {
    expect(
      computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("needs_review")], openHitlTaskCount: 0, caseMode: "standalone" })
    ).toBe("needs_provider_action");
  });

  it("needs_client_review — connected Case with an open HITL task takes priority over a plain fail", () => {
    expect(
      computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("needs_review")], openHitlTaskCount: 1, caseMode: "client_connected" })
    ).toBe("needs_client_review");
  });

  it("processing_failed — blocking rule technical error, no requirement/HITL issues", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("processing_error")], openHitlTaskCount: 0, caseMode: "standalone" })).toBe(
      "processing_failed"
    );
  });

  it("issues_found — blocking rule fails", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("fail")], openHitlTaskCount: 0, caseMode: "standalone" })).toBe("issues_found");
  });

  it("passed_with_warnings — only a non-blocking rule failed", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("fail", "warning")], openHitlTaskCount: 0, caseMode: "standalone" })).toBe(
      "passed_with_warnings"
    );
  });

  it("a skipped rule never affects the overall result", () => {
    expect(computeOverallValidationResult({ requirements: [requirement("satisfied")], ruleResults: [rule("skipped")], openHitlTaskCount: 0, caseMode: "standalone" })).toBe("passed");
  });
});
