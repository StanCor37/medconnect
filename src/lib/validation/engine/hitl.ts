import type { RuleOutcome, HitlPolicy } from "@/generated/prisma/enums";

/**
 * spec §18: "Create HITL when a rule returns needs_review, HITL policy
 * requires it..." — these are OR'd triggers. The spec doesn't define the
 * exact policy-to-outcome mapping (left as an open design task per §33),
 * so this is the concrete decision: "never" is an absolute override;
 * "on_needs_review" only escalates a needs_review outcome; "on_fail"
 * escalates fail-or-worse; "always" escalates any real outcome (not
 * skipped/not_executed/processing_error, which aren't a human decision to make).
 */
export function shouldCreateHitlTask(outcome: RuleOutcome, hitlPolicy: HitlPolicy): boolean {
  if (hitlPolicy === "never") return false;
  const realOutcomes: RuleOutcome[] = ["pass", "fail", "needs_review"];
  if (!realOutcomes.includes(outcome)) return false;

  switch (hitlPolicy) {
    case "on_needs_review":
      return outcome === "needs_review";
    case "on_fail":
      return outcome === "fail" || outcome === "needs_review";
    case "always":
      return true;
    default:
      return false;
  }
}
