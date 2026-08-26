import { createHash } from "node:crypto";
import type { DeterministicRuleDefinition } from "@/lib/validation/rule";
import { resolveFieldPath } from "@/lib/rules/evaluateDeterministicRule";
import type { ResolvedValidationInput } from "@/lib/validation/engine/resolvedInput";

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Whole-run pin — spec §2's "calculate the input snapshot hash." */
export function hashResolvedInput(input: ResolvedValidationInput): string {
  return sha256(stableStringify(input));
}

/**
 * Every field path a deterministic rule's own definition references — the
 * selective-revalidation key (spec §21, simplified per the plan's deferral
 * of a full ValidationDependency graph): hashing only these values, not the
 * whole input, is what lets an unrelated field change leave this rule's
 * result untouched.
 */
export function extractFieldPathsFromDefinition(definition: DeterministicRuleDefinition): string[] {
  switch (definition.operation) {
    case "required_document":
      return [definition.parameters.documentTypePath];
    case "required_field":
      return [definition.parameters.fieldPath];
    case "equals":
    case "not_equals": {
      const p = definition.parameters;
      return p.mode === "fieldToField" ? [p.fieldPathA, p.fieldPathB] : [p.fieldPath];
    }
    case "date_between":
      return [definition.parameters.datePath, definition.parameters.startPath, definition.parameters.endPath];
    case "date_before":
    case "date_after": {
      const p = definition.parameters;
      return [p.datePath, ...(p.boundaryPath ? [p.boundaryPath] : [])];
    }
    case "amount_less_than_or_equal":
    case "amount_greater_than": {
      const p = definition.parameters;
      return [p.amountPath, ...(p.thresholdPath ? [p.thresholdPath] : [])];
    }
    default: {
      const exhaustive: never = definition;
      throw new Error(`Unhandled deterministic operation: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Same idea for an ai_assisted rule — the paths its own applicability gate declares. */
export function extractFieldPathsFromGate(gate: { requiredDocumentTypes: string[]; requiredFields: string[]; triggeringValues: Record<string, unknown>; skipConditions: string[] }): string[] {
  return [...gate.requiredDocumentTypes.map((c) => `documents.${c}`), ...gate.requiredFields, ...Object.keys(gate.triggeringValues), ...gate.skipConditions];
}

/** Hash of only the resolved values at `paths` — the per-rule cache key (ValidationRuleResult.inputSubsetHash). */
export function hashInputSubset(input: ResolvedValidationInput, paths: string[]): string {
  const inputRecord = input as unknown as Record<string, unknown>;
  const values = paths
    .slice()
    .sort()
    .map((path) => [path, resolveFieldPath(inputRecord, path).value]);
  return sha256(stableStringify(values));
}
