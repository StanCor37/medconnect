import type { AiRuleDefinition } from "@/lib/validation/rule";
import { resolveFieldPath } from "@/lib/rules/evaluateDeterministicRule";
import type { ResolvedValidationInput } from "@/lib/validation/engine/resolvedInput";

export interface ApplicabilityGateResult {
  applicable: boolean;
  reasonCode: string;
}

/**
 * Pure, no network call — proves "AI runs only after applicability gates"
 * independently of any Claude call. Reuses evaluateDeterministicRule.ts's
 * own resolveFieldPath/dot-notation convention verbatim, so
 * requiredFields/skipConditions/triggeringValues entries are full paths
 * like "documents.invoice" or "fields.invoice.total_cost", exactly like
 * deterministic rule definitions.
 */
export function evaluateApplicabilityGate(
  gate: AiRuleDefinition["applicabilityGate"],
  input: ResolvedValidationInput
): ApplicabilityGateResult {
  const inputRecord = input as unknown as Record<string, unknown>;

  for (const docType of gate.requiredDocumentTypes) {
    if (!input.documents[docType]) {
      return { applicable: false, reasonCode: `required_document_type_missing:${docType}` };
    }
  }

  for (const path of gate.requiredFields) {
    const resolved = resolveFieldPath(inputRecord, path);
    if (!resolved.found || resolved.value === null || resolved.value === undefined) {
      return { applicable: false, reasonCode: `required_field_missing:${path}` };
    }
  }

  for (const [path, expectedValue] of Object.entries(gate.triggeringValues)) {
    const resolved = resolveFieldPath(inputRecord, path);
    if (!resolved.found || resolved.value !== expectedValue) {
      return { applicable: false, reasonCode: `triggering_value_not_met:${path}` };
    }
  }

  for (const path of gate.skipConditions) {
    const resolved = resolveFieldPath(inputRecord, path);
    if (resolved.found && resolved.value) {
      return { applicable: false, reasonCode: `skip_condition_met:${path}` };
    }
  }

  return { applicable: true, reasonCode: "applicability_gate_passed" };
}
