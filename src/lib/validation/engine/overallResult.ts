import type { OverallValidationResult } from "@/generated/prisma/enums";
import type { RequirementResultDraft } from "@/lib/validation/engine/requirements";
import type { RuleResultDraft } from "@/lib/validation/engine/deterministicPhase";

export interface OverallResultInput {
  requirements: RequirementResultDraft[];
  ruleResults: RuleResultDraft[];
  openHitlTaskCount: number;
  caseMode: "standalone" | "client_connected";
}

/**
 * Pure and standalone-testable (spec §32 "overall result is deterministic",
 * §10 "never use an LLM to calculate the overall result"). The spec defines
 * every value but not their relative priority — this ladder (first match
 * wins) is the concrete design decision.
 */
export function computeOverallValidationResult(input: OverallResultInput): OverallValidationResult {
  const { requirements, ruleResults, openHitlTaskCount, caseMode } = input;

  if (requirements.some((r) => r.status === "missing" || r.status === "unreadable")) {
    return "incomplete";
  }

  const hasUnconfirmedOrInvalidRequirement = requirements.some((r) => r.status === "unconfirmed" || r.status === "invalid");
  const blockingNeedsReviewOrUnresolved = ruleResults.some(
    (r) => r.severity === "blocking" && (r.outcome === "needs_review" || r.outcome === "not_executed")
  );
  if (hasUnconfirmedOrInvalidRequirement || (caseMode === "standalone" && blockingNeedsReviewOrUnresolved)) {
    return "needs_provider_action";
  }

  if (caseMode === "client_connected" && openHitlTaskCount > 0) {
    return "needs_client_review";
  }

  if (ruleResults.some((r) => r.severity === "blocking" && r.outcome === "processing_error")) {
    return "processing_failed";
  }

  if (ruleResults.some((r) => r.severity === "blocking" && r.outcome === "fail")) {
    return "issues_found";
  }

  const nonBlockingIssue = new Set(["fail", "needs_review", "processing_error", "not_executed"]);
  if (ruleResults.some((r) => r.severity !== "blocking" && nonBlockingIssue.has(r.outcome))) {
    return "passed_with_warnings";
  }

  return "passed";
}
