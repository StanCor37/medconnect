import type { RecommendationCode } from "@/generated/prisma/enums";

/**
 * Maps a missing/unreadable/unconfirmed REQUIREMENT to one of spec §14's 8
 * canned application-owned templates. The spec defines the closed set of
 * codes but not this exact mapping — this is the concrete design decision,
 * fully unit-testable, with a safe generic fallback for anything unmapped.
 */
export function recommendationForRequirement(
  requirementType: "document" | "field" | "readability" | "classification" | "split_confirmation",
  documentTypeCode: string | null
): RecommendationCode | null {
  if (requirementType === "classification") return "confirm_document_type";
  if (requirementType === "readability") return "upload_clearer_invoice";
  if (requirementType === "document") {
    if (documentTypeCode === "medical_report") return "upload_medical_report";
    if (documentTypeCode === "invoice") return "upload_clearer_invoice";
    return "upload_medical_report"; // generic "you're missing a required document" fallback
  }
  if (requirementType === "field") {
    if (documentTypeCode === "invoice") return "confirm_policy_period";
    return "review_patient_name";
  }
  return null;
}

/** Maps a failed RULE (by category, since the spec doesn't define a literal reason-code -> recommendation table) to one of the 8 canned codes. */
export function recommendationForRuleFailure(category: string, reasonCode: string): RecommendationCode | null {
  if (reasonCode.includes("date")) return "review_event_date";
  if (reasonCode.includes("name")) return "review_patient_name";
  if (category === "eligibility") return "confirm_policy_period";
  if (category === "financial_validation") return "review_event_date";
  if (category === "document_requirement") return "upload_clearer_invoice";
  return "request_client_review";
}
