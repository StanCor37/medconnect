import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateDeterministicRule,
  resolveFieldPath,
  normalizeNameValue,
  normalizeDateValue,
  normalizeMoneyMinorUnits,
} from "@/lib/rules/evaluateDeterministicRule";
import type { DeterministicRuleDefinition } from "@/lib/validation/rule";

describe("evaluateDeterministicRule — zero-LLM-dependency proof (spec §26.9)", () => {
  it("the evaluator's own source contains no network/SDK imports", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/lib/rules/evaluateDeterministicRule.ts"),
      "utf8"
    );
    const lower = source.toLowerCase();
    for (const forbidden of ["fetch(", "openai", "anthropic", "http.request", "axios"]) {
      expect(lower.includes(forbidden)).toBe(false);
    }
  });
});

describe("resolveFieldPath", () => {
  it("resolves nested dot-notation paths", () => {
    const r = resolveFieldPath({ medical_report: { examination_date: "2026-01-01" } }, "medical_report.examination_date");
    expect(r).toEqual({ found: true, value: "2026-01-01" });
  });
  it("found=false when a segment is missing", () => {
    const r = resolveFieldPath({ medical_report: {} }, "medical_report.examination_date");
    expect(r.found).toBe(false);
  });
  it("explicit null still counts as found", () => {
    const r = resolveFieldPath({ medical_report: { examination_date: null } }, "medical_report.examination_date");
    expect(r).toEqual({ found: true, value: null });
  });
});

describe("normalization", () => {
  it("normalizeNameValue strips composable diacritics, case, and punctuation", () => {
    // Hyphen is stripped as punctuation with no surrounding space, so words merge.
    expect(normalizeNameValue("  Müller-Schmidt  ")).toBe("mullerschmidt");
    // Đ/đ (D with stroke) is a distinct Unicode letter, not a combining-mark
    // composition — NFKD does not decompose it, so it survives; the acute
    // accent on Ć does decompose and gets stripped.
    expect(normalizeNameValue("ĐORĐEVIĆ")).toBe("đorđevic");
  });
  it("normalizeDateValue accepts multiple formats and yields the same ISO date", () => {
    expect(normalizeDateValue("2026-03-05")).toBe("2026-03-05");
    expect(normalizeDateValue("2026-03-05T10:00:00Z")).toBe("2026-03-05");
    expect(normalizeDateValue(new Date(Date.UTC(2026, 2, 5)))).toBe("2026-03-05");
  });
  it("normalizeMoneyMinorUnits avoids float-precision traps via integer comparison", () => {
    const a = normalizeMoneyMinorUnits(10.1);
    const b = normalizeMoneyMinorUnits(0.2);
    expect(a).toBe(1010);
    expect(b).toBe(20);
    expect(a! + b!).toBe(1030); // integer arithmetic, no 10.1+0.2 float drift
  });
});

describe("evaluateDeterministicRule — one pass/fail case per operation, missing path -> skipped", () => {
  it("required_document: pass/fail/skipped", () => {
    const def: DeterministicRuleDefinition = { operation: "required_document", parameters: { documentTypePath: "documents.medical_report" } };
    expect(evaluateDeterministicRule(def, { documents: { medical_report: true } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(def, { documents: { medical_report: false } }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(def, { documents: {} }).outcome).toBe("skipped");
  });

  it("required_field: pass/fail/skipped", () => {
    const def: DeterministicRuleDefinition = { operation: "required_field", parameters: { fieldPath: "invoice.total_cost" } };
    expect(evaluateDeterministicRule(def, { invoice: { total_cost: 100 } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(def, { invoice: { total_cost: null } }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(def, { invoice: {} }).outcome).toBe("skipped");
  });

  it("equals (fieldToField, name type): pass/fail/skipped", () => {
    const def: DeterministicRuleDefinition = {
      operation: "equals",
      parameters: { mode: "fieldToField", fieldPathA: "report.patient_name", fieldPathB: "invoice.patient_name", valueType: "name" },
    };
    expect(evaluateDeterministicRule(def, { report: { patient_name: "Ana Jovanović" }, invoice: { patient_name: "ANA JOVANOVIC" } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(def, { report: { patient_name: "Ana" }, invoice: { patient_name: "Petar" } }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(def, { report: {}, invoice: { patient_name: "Petar" } }).outcome).toBe("skipped");
  });

  it("not_equals (fieldToValue): pass/fail/skipped", () => {
    const def: DeterministicRuleDefinition = {
      operation: "not_equals",
      parameters: { mode: "fieldToValue", fieldPath: "case.status", expectedValue: "rejected", valueType: "string" },
    };
    expect(evaluateDeterministicRule(def, { case: { status: "approved" } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(def, { case: { status: "rejected" } }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(def, {}).outcome).toBe("skipped");
  });

  it("date_between: pass/fail/skipped", () => {
    const def: DeterministicRuleDefinition = {
      operation: "date_between",
      parameters: { datePath: "event.date", startPath: "policy.start", endPath: "policy.end", inclusiveStart: true, inclusiveEnd: true },
    };
    const policy = { policy: { start: "2026-01-01", end: "2026-12-31" } };
    expect(evaluateDeterministicRule(def, { event: { date: "2026-06-01" }, ...policy }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(def, { event: { date: "2027-01-01" }, ...policy }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(def, { ...policy }).outcome).toBe("skipped");
  });

  it("date_before / date_after: pass/fail/skipped", () => {
    const before: DeterministicRuleDefinition = {
      operation: "date_before",
      parameters: { datePath: "person.birth_date", boundaryValue: "2011-01-01", inclusive: false },
    };
    expect(evaluateDeterministicRule(before, { person: { birth_date: "2010-01-01" } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(before, { person: { birth_date: "2015-01-01" } }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(before, { person: {} }).outcome).toBe("skipped");

    const after: DeterministicRuleDefinition = {
      operation: "date_after",
      parameters: { datePath: "person.birth_date", boundaryValue: "2011-01-01", inclusive: false },
    };
    expect(evaluateDeterministicRule(after, { person: { birth_date: "2015-01-01" } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(after, { person: { birth_date: "2010-01-01" } }).outcome).toBe("fail");
  });

  it("amount_less_than_or_equal / amount_greater_than: pass/fail/skipped", () => {
    const lte: DeterministicRuleDefinition = {
      operation: "amount_less_than_or_equal",
      parameters: { amountPath: "invoice.dental_cost", thresholdValue: 150 },
    };
    expect(evaluateDeterministicRule(lte, { invoice: { dental_cost: 120 } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(lte, { invoice: { dental_cost: 200 } }).outcome).toBe("fail");
    expect(evaluateDeterministicRule(lte, { invoice: {} }).outcome).toBe("skipped");

    const gt: DeterministicRuleDefinition = {
      operation: "amount_greater_than",
      parameters: { amountPath: "invoice.total_cost", thresholdValue: 1000 },
    };
    expect(evaluateDeterministicRule(gt, { invoice: { total_cost: 1500 } }).outcome).toBe("pass");
    expect(evaluateDeterministicRule(gt, { invoice: { total_cost: 500 } }).outcome).toBe("fail");
  });
});
