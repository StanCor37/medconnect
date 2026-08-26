import type { DeterministicRuleDefinition } from "@/lib/validation/rule";

/**
 * Pure functions only — zero side effects, zero network/SDK imports. This is
 * asserted literally by a test that reads this file's own source (see
 * tests/lib/evaluateDeterministicRule.test.ts), satisfying spec Segment 3
 * §26.9's "prove deterministic rules never call an LLM" requirement in the
 * most tamper-evident way available.
 *
 * Not wired to any real Case/Document yet — there is no real extracted-field
 * input to resolve against until Segments 5/6 exist. This module exists so
 * Segment 7 has a ready, proven building block, and so the 9 v1 operations
 * can be tested in isolation right now.
 */

export interface FieldResolution {
  found: boolean;
  value: unknown;
}

/** Dot-notation resolver. found=false iff any segment is undefined — an explicit null still counts as found. */
export function resolveFieldPath(input: Record<string, unknown>, path: string): FieldResolution {
  const segments = path.split(".");
  let current: unknown = input;
  for (const segment of segments) {
    if (current === undefined || current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    if (!(segment in (current as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

/** trim/lowercase/NFKD/strip diacritics+punctuation — same recipe as normalizeProviderName. */
export function normalizeNameValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (after NFKD decomposition)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** -> ISO "YYYY-MM-DD", or null if unparseable. */
export function normalizeDateValue(v: unknown): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Integer minor units (e.g. cents) — flat 2-decimal assumption, not a
 * per-currency table (documented simplification; real per-currency
 * precision is Segment 6/7's concern once real extracted money fields
 * exist). Always compare the return value as an integer, never as a float.
 */
export function normalizeMoneyMinorUnits(v: unknown): number | null {
  const num = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100);
}

export type DeterministicOutcome = "pass" | "fail" | "skipped";

export interface DeterministicEvaluationResult {
  outcome: DeterministicOutcome;
  reasonCode: string;
}

function skipped(reasonCode: string): DeterministicEvaluationResult {
  return { outcome: "skipped", reasonCode };
}
function pass(reasonCode: string): DeterministicEvaluationResult {
  return { outcome: "pass", reasonCode };
}
function fail(reasonCode: string): DeterministicEvaluationResult {
  return { outcome: "fail", reasonCode };
}

function resolveComparableValue(
  input: Record<string, unknown>,
  side: { path?: string; value?: unknown }
): FieldResolution {
  if (side.path !== undefined) return resolveFieldPath(input, side.path);
  return { found: true, value: side.value };
}

function normalizeByType(value: unknown, valueType: "string" | "name" | "date" | "money"): unknown {
  switch (valueType) {
    case "name":
      return normalizeNameValue(value);
    case "date":
      return normalizeDateValue(value);
    case "money":
      return normalizeMoneyMinorUnits(value);
    default:
      return typeof value === "string" ? value.trim() : value;
  }
}

export function evaluateDeterministicRule(
  definition: DeterministicRuleDefinition,
  input: Record<string, unknown>
): DeterministicEvaluationResult {
  switch (definition.operation) {
    case "required_document": {
      const r = resolveFieldPath(input, definition.parameters.documentTypePath);
      if (!r.found) return skipped(`field_path_not_found:${definition.parameters.documentTypePath}`);
      return r.value ? pass("document_present") : fail("document_missing");
    }

    case "required_field": {
      const r = resolveFieldPath(input, definition.parameters.fieldPath);
      if (!r.found) return skipped(`field_path_not_found:${definition.parameters.fieldPath}`);
      return r.value === null || r.value === undefined || r.value === ""
        ? fail("field_missing")
        : pass("field_present");
    }

    case "equals":
    case "not_equals": {
      const params = definition.parameters;
      const left = resolveComparableValue(input, { path: params.mode === "fieldToField" ? params.fieldPathA : params.fieldPath });
      const right = resolveComparableValue(
        input,
        params.mode === "fieldToField" ? { path: params.fieldPathB } : { value: params.expectedValue }
      );
      if (!left.found) return skipped(`field_path_not_found:${params.mode === "fieldToField" ? params.fieldPathA : params.fieldPath}`);
      if (!right.found) return skipped(`field_path_not_found:${params.mode === "fieldToField" ? params.fieldPathB : "expectedValue"}`);
      const leftNorm = normalizeByType(left.value, params.valueType);
      const rightNorm = normalizeByType(right.value, params.valueType);
      const equal = leftNorm !== null && rightNorm !== null && leftNorm === rightNorm;
      if (definition.operation === "equals") {
        return equal ? pass("values_equal") : fail("values_not_equal");
      }
      return equal ? fail("values_equal") : pass("values_not_equal");
    }

    case "date_between": {
      const { datePath, startPath, endPath, inclusiveStart, inclusiveEnd } = definition.parameters;
      const dateR = resolveFieldPath(input, datePath);
      const startR = resolveFieldPath(input, startPath);
      const endR = resolveFieldPath(input, endPath);
      if (!dateR.found) return skipped(`field_path_not_found:${datePath}`);
      if (!startR.found) return skipped(`field_path_not_found:${startPath}`);
      if (!endR.found) return skipped(`field_path_not_found:${endPath}`);
      const date = normalizeDateValue(dateR.value);
      const start = normalizeDateValue(startR.value);
      const end = normalizeDateValue(endR.value);
      if (date === null || start === null || end === null) return fail("invalid_date");
      const afterStart = inclusiveStart ? date >= start : date > start;
      const beforeEnd = inclusiveEnd ? date <= end : date < end;
      return afterStart && beforeEnd ? pass("date_in_range") : fail("date_out_of_range");
    }

    case "date_before":
    case "date_after": {
      const params = definition.parameters;
      const dateR = resolveFieldPath(input, params.datePath);
      const boundaryR = resolveComparableValue(
        input,
        params.boundaryPath !== undefined ? { path: params.boundaryPath } : { value: params.boundaryValue }
      );
      if (!dateR.found) return skipped(`field_path_not_found:${params.datePath}`);
      if (!boundaryR.found) return skipped(`field_path_not_found:${params.boundaryPath ?? "boundaryValue"}`);
      const date = normalizeDateValue(dateR.value);
      const boundary = normalizeDateValue(boundaryR.value);
      if (date === null || boundary === null) return fail("invalid_date");
      const inclusive = params.inclusive ?? false;
      if (definition.operation === "date_before") {
        const result = inclusive ? date <= boundary : date < boundary;
        return result ? pass("date_before_boundary") : fail("date_not_before_boundary");
      }
      const result = inclusive ? date >= boundary : date > boundary;
      return result ? pass("date_after_boundary") : fail("date_not_after_boundary");
    }

    case "amount_less_than_or_equal":
    case "amount_greater_than": {
      const params = definition.parameters;
      const amountR = resolveFieldPath(input, params.amountPath);
      const thresholdR = resolveComparableValue(
        input,
        params.thresholdPath !== undefined ? { path: params.thresholdPath } : { value: params.thresholdValue }
      );
      if (!amountR.found) return skipped(`field_path_not_found:${params.amountPath}`);
      if (!thresholdR.found) {
        return skipped(`field_path_not_found:${params.thresholdPath ?? "thresholdValue"}`);
      }
      const amount = normalizeMoneyMinorUnits(amountR.value);
      const threshold = normalizeMoneyMinorUnits(thresholdR.value);
      if (amount === null || threshold === null) return fail("invalid_amount");
      if (definition.operation === "amount_less_than_or_equal") {
        return amount <= threshold ? pass("amount_within_threshold") : fail("amount_exceeds_threshold");
      }
      return amount > threshold ? pass("amount_exceeds_threshold") : fail("amount_within_threshold");
    }

    default: {
      const exhaustive: never = definition;
      throw new Error(`Unhandled deterministic operation: ${JSON.stringify(exhaustive)}`);
    }
  }
}
