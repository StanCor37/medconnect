import { describe, it, expect } from "vitest";
import { evaluateApplicabilityGate } from "@/lib/validation/engine/applicabilityGate";
import type { ResolvedValidationInput } from "@/lib/validation/engine/resolvedInput";

function input(overrides: Partial<ResolvedValidationInput> = {}): ResolvedValidationInput {
  return { case: {}, documents: {}, fields: {}, ...overrides };
}

describe("evaluateApplicabilityGate — pure, spec §6 'AI runs only after applicability gates'", () => {
  it("applicable when no gate conditions are configured at all", () => {
    const gate = { requiredDocumentTypes: [], requiredFields: [], triggeringValues: {}, skipConditions: [] };
    expect(evaluateApplicabilityGate(gate, input()).applicable).toBe(true);
  });

  it("not applicable — a required document type is missing", () => {
    const gate = { requiredDocumentTypes: ["medical_report"], requiredFields: [], triggeringValues: {}, skipConditions: [] };
    const result = evaluateApplicabilityGate(gate, input({ documents: {} }));
    expect(result.applicable).toBe(false);
    expect(result.reasonCode).toContain("required_document_type_missing");
  });

  it("applicable — the required document type is present", () => {
    const gate = { requiredDocumentTypes: ["medical_report"], requiredFields: [], triggeringValues: {}, skipConditions: [] };
    expect(evaluateApplicabilityGate(gate, input({ documents: { medical_report: true } })).applicable).toBe(true);
  });

  it("not applicable — a required field is missing", () => {
    const gate = { requiredDocumentTypes: [], requiredFields: ["fields.invoice.total_cost"], triggeringValues: {}, skipConditions: [] };
    const result = evaluateApplicabilityGate(gate, input({ fields: {} }));
    expect(result.applicable).toBe(false);
    expect(result.reasonCode).toContain("required_field_missing");
  });

  it("not applicable — a triggering value doesn't match", () => {
    const gate = { requiredDocumentTypes: [], requiredFields: [], triggeringValues: { "case.serviceType": "inpatient" }, skipConditions: [] };
    const result = evaluateApplicabilityGate(gate, input({ case: { serviceType: "outpatient" } }));
    expect(result.applicable).toBe(false);
    expect(result.reasonCode).toContain("triggering_value_not_met");
  });

  it("applicable — the triggering value matches", () => {
    const gate = { requiredDocumentTypes: [], requiredFields: [], triggeringValues: { "case.serviceType": "inpatient" }, skipConditions: [] };
    expect(evaluateApplicabilityGate(gate, input({ case: { serviceType: "inpatient" } })).applicable).toBe(true);
  });

  it("not applicable — a skip condition is truthy", () => {
    const gate = { requiredDocumentTypes: [], requiredFields: [], triggeringValues: {}, skipConditions: ["documents.waiver"] };
    const result = evaluateApplicabilityGate(gate, input({ documents: { waiver: true } }));
    expect(result.applicable).toBe(false);
    expect(result.reasonCode).toContain("skip_condition_met");
  });
});
