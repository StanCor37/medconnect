import { testDb, uniqueSuffix } from "./testDb";
import type { Fixtures } from "./fixtures";
import type { DocumentFixtures } from "./documentFixtures";

/**
 * Layers a deterministic + an ai_assisted Rule onto documentFixtures.ts's
 * already-published scheme/Document Types, matching the exact dot-path
 * convention the real engine (resolvedInput.ts) produces — unlike
 * ruleFixtures.ts's Rules, which were built for Segment 3 CRUD testing only
 * and were never meant to be executed against a real resolved input.
 */
export async function buildValidationFixtures(fx: Fixtures, dfx: DocumentFixtures) {
  const s = uniqueSuffix();

  const totalCostField = await testDb.extractionFieldDefinition.create({
    data: { documentTypeId: dfx.invoiceType.id, code: "total_cost", label: "Total cost", valueType: "money", required: true },
  });

  const deterministicRule = await testDb.validationRule.create({
    data: {
      scope: "client",
      clientId: fx.clientA.id,
      category: "financial_validation",
      executionType: "deterministic",
      name: `Test Deterministic Rule ${s}`,
      status: "draft",
      createdByUserId: fx.clientAdminA.id,
    },
  });
  const deterministicRuleVersion = await testDb.validationRuleVersion.create({
    data: {
      ruleId: deterministicRule.id,
      versionNumber: 1,
      name: deterministicRule.name,
      definition: { operation: "required_field", parameters: { fieldPath: "fields.invoice.total_cost" } },
      applicability: {},
      providerMessageCode: "test_total_cost_required",
      adminMessageCode: "test_total_cost_required",
      severity: "blocking",
      hitlPolicy: "never",
      publishedAt: new Date(),
      publishedByUserId: fx.clientAdminA.id,
    },
  });
  await testDb.validationRule.update({ where: { id: deterministicRule.id }, data: { currentVersionId: deterministicRuleVersion.id, status: "published" } });

  const aiRule = await testDb.validationRule.create({
    data: {
      scope: "client",
      clientId: fx.clientA.id,
      category: "eligibility",
      executionType: "ai_assisted",
      name: `Test AI Rule ${s}`,
      status: "draft",
      createdByUserId: fx.clientAdminA.id,
    },
  });
  const aiRuleVersion = await testDb.validationRuleVersion.create({
    data: {
      ruleId: aiRule.id,
      versionNumber: 1,
      name: aiRule.name,
      definition: {
        evaluationQuestion: "Does the medical report describe a condition excluded by the policy?",
        evidenceRequirements: ["medical_report"],
        applicabilityGate: { requiredDocumentTypes: ["medical_report"], requiredFields: [], triggeringValues: {}, skipConditions: [] },
        outputSchema: "AiRuleOutput",
      },
      applicability: {},
      providerMessageCode: "test_ai_exclusion",
      adminMessageCode: "test_ai_exclusion",
      severity: "warning",
      hitlPolicy: "on_needs_review",
      publishedAt: new Date(),
      publishedByUserId: fx.clientAdminA.id,
    },
  });
  await testDb.validationRule.update({ where: { id: aiRule.id }, data: { currentVersionId: aiRuleVersion.id, status: "published" } });

  const deterministicSchemeRule = await testDb.validationSchemeRule.create({
    data: { schemeVersionId: dfx.schemeVersion.id, ruleVersionId: deterministicRuleVersion.id, executionOrder: 0 },
  });
  const aiSchemeRule = await testDb.validationSchemeRule.create({
    data: { schemeVersionId: dfx.schemeVersion.id, ruleVersionId: aiRuleVersion.id, executionOrder: 1 },
  });

  const ruleIds = [deterministicRule.id, aiRule.id];

  async function cleanup() {
    await testDb.validationSchemeRule.deleteMany({ where: { id: { in: [deterministicSchemeRule.id, aiSchemeRule.id] } } });
    await testDb.validationRule.updateMany({ where: { id: { in: ruleIds } }, data: { currentVersionId: null } });
    await testDb.validationRuleVersion.deleteMany({ where: { ruleId: { in: ruleIds } } });
    await testDb.validationRule.deleteMany({ where: { id: { in: ruleIds } } });
    await testDb.extractionFieldDefinition.delete({ where: { id: totalCostField.id } }).catch(() => {});
  }

  return {
    suffix: s,
    totalCostField,
    deterministicRule,
    deterministicRuleVersion,
    deterministicSchemeRule,
    aiRule,
    aiRuleVersion,
    aiSchemeRule,
    cleanup,
  };
}

export type ValidationFixtures = Awaited<ReturnType<typeof buildValidationFixtures>>;

/**
 * Directly inserts a confirmed, readable Document + optional ExtractedField
 * values — bypassing the real upload/OCR/classification pipeline entirely.
 * The validation engine only cares about final DB state, not how it got
 * there, so this is faster and more controlled than exercising the full
 * pipeline for every engine test, matching ruleFixtures.ts's own precedent
 * of building rows directly.
 */
export async function createConfirmedDocument(
  caseRow: { id: string; providerId: string },
  createdByUserId: string,
  documentTypeCode: string,
  fields: { fieldDefinitionId: string; valueType: string; confirmedValue: unknown; status?: string }[] = []
) {
  const s = uniqueSuffix();
  const sourceFile = await testDb.sourceFile.create({
    data: {
      caseId: caseRow.id,
      providerId: caseRow.providerId,
      uploadedByUserId: createdByUserId,
      originalFilename: `test-${s}.pdf`,
      mimeType: "application/pdf",
      byteSize: 100,
      contentHash: `hash-${s}`,
      storageKey: `test/${s}`,
    },
  });
  const document = await testDb.document.create({
    data: { caseId: caseRow.id, documentTypeCode, createdByUserId },
  });
  const version = await testDb.documentVersion.create({
    data: {
      documentId: document.id,
      versionNumber: 1,
      sourceFileId: sourceFile.id,
      readabilityStatus: "readable",
      classificationStatus: "confirmed",
      confirmedTypeCode: documentTypeCode,
      createdByUserId,
    },
  });
  await testDb.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });

  for (const f of fields) {
    await testDb.extractedField.create({
      data: {
        caseId: caseRow.id,
        documentId: document.id,
        documentVersionId: version.id,
        fieldDefinitionId: f.fieldDefinitionId,
        valueType: f.valueType as never,
        extractionMethod: "provider_entered",
        status: (f.status ?? "confirmed") as never,
        confirmedValue: f.confirmedValue as never,
        confirmedByUserId: createdByUserId,
        confirmedAt: new Date(),
      },
    });
  }

  return { document, version, sourceFile };
}
