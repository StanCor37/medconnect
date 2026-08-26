import { testDb, uniqueSuffix } from "./testDb";
import type { Fixtures } from "./fixtures";

/**
 * Builds one isolated set of Rules/Schemes per test run, layered on top of
 * an existing `Fixtures` set. Kept in a separate file (not added to
 * fixtures.ts) so unrelated test files stay unaffected by Rule/Scheme
 * fixture changes.
 */
export async function buildRuleFixtures(fx: Fixtures) {
  const s = uniqueSuffix();

  // One published global deterministic rule.
  const globalRule = await testDb.validationRule.create({
    data: {
      scope: "global",
      category: "document_requirement",
      executionType: "deterministic",
      name: `Test Global Rule ${s}`,
      status: "draft",
      createdByUserId: fx.superAdmin.id,
    },
  });
  const globalRuleVersion = await testDb.validationRuleVersion.create({
    data: {
      ruleId: globalRule.id,
      versionNumber: 1,
      name: globalRule.name,
      definition: { operation: "required_field", parameters: { fieldPath: "invoice.total_cost" } },
      applicability: {},
      providerMessageCode: "test_required_field",
      adminMessageCode: "test_required_field",
      severity: "blocking",
      hitlPolicy: "never",
      publishedAt: new Date(),
      publishedByUserId: fx.superAdmin.id,
    },
  });
  await testDb.validationRule.update({ where: { id: globalRule.id }, data: { currentVersionId: globalRuleVersion.id, status: "published" } });

  // One published Client-A-owned rule.
  const clientRule = await testDb.validationRule.create({
    data: {
      scope: "client",
      clientId: fx.clientA.id,
      category: "document_requirement",
      executionType: "deterministic",
      name: `Test Client A Rule ${s}`,
      status: "draft",
      createdByUserId: fx.clientAdminA.id,
    },
  });
  const clientRuleVersion = await testDb.validationRuleVersion.create({
    data: {
      ruleId: clientRule.id,
      versionNumber: 1,
      name: clientRule.name,
      definition: { operation: "required_field", parameters: { fieldPath: "invoice.reference_number" } },
      applicability: {},
      providerMessageCode: "test_required_field_2",
      adminMessageCode: "test_required_field_2",
      severity: "blocking",
      hitlPolicy: "never",
      publishedAt: new Date(),
      publishedByUserId: fx.clientAdminA.id,
    },
  });
  await testDb.validationRule.update({ where: { id: clientRule.id }, data: { currentVersionId: clientRuleVersion.id, status: "published" } });

  // One never-published Client-A-owned draft rule.
  const clientDraftRule = await testDb.validationRule.create({
    data: {
      scope: "client",
      clientId: fx.clientA.id,
      category: "eligibility",
      executionType: "ai_assisted",
      name: `Test Client A Draft Rule ${s}`,
      status: "draft",
      createdByUserId: fx.clientAdminA.id,
    },
  });
  const clientDraftRuleVersion = await testDb.validationRuleVersion.create({
    data: {
      ruleId: clientDraftRule.id,
      versionNumber: 1,
      name: clientDraftRule.name,
      definition: {
        evaluationQuestion: "Is this excluded?",
        evidenceRequirements: ["medical_report"],
        applicabilityGate: { requiredDocumentTypes: [], requiredFields: [], triggeringValues: {}, skipConditions: [] },
        outputSchema: "AiRuleOutput",
      },
      applicability: {},
      providerMessageCode: "test_ai_rule",
      adminMessageCode: "test_ai_rule",
      severity: "warning",
      hitlPolicy: "on_needs_review",
      // never published
    },
  });
  await testDb.validationRule.update({ where: { id: clientDraftRule.id }, data: { currentVersionId: clientDraftRuleVersion.id } });

  // One published global scheme containing the global rule.
  const globalScheme = await testDb.validationScheme.create({
    data: { scope: "global", name: `Test Global Scheme ${s}`, countryCodes: [], status: "draft", createdByUserId: fx.superAdmin.id },
  });
  const globalSchemeVersion = await testDb.validationSchemeVersion.create({
    data: { schemeId: globalScheme.id, versionNumber: 1, publishedAt: new Date(), publishedByUserId: fx.superAdmin.id },
  });
  await testDb.validationSchemeRule.create({
    data: { schemeVersionId: globalSchemeVersion.id, ruleVersionId: globalRuleVersion.id },
  });
  await testDb.validationScheme.update({
    where: { id: globalScheme.id },
    data: { currentVersionId: globalSchemeVersion.id, status: "published" },
  });

  // One published Client-A scheme containing BOTH the global rule and the Client A rule.
  const clientScheme = await testDb.validationScheme.create({
    data: {
      scope: "client",
      clientId: fx.clientA.id,
      name: `Test Client A Scheme ${s}`,
      countryCodes: [],
      status: "draft",
      createdByUserId: fx.clientAdminA.id,
    },
  });
  const clientSchemeVersion = await testDb.validationSchemeVersion.create({
    data: { schemeId: clientScheme.id, versionNumber: 1, publishedAt: new Date(), publishedByUserId: fx.clientAdminA.id },
  });
  await testDb.validationSchemeRule.createMany({
    data: [
      { schemeVersionId: clientSchemeVersion.id, ruleVersionId: globalRuleVersion.id },
      { schemeVersionId: clientSchemeVersion.id, ruleVersionId: clientRuleVersion.id },
    ],
  });
  await testDb.validationScheme.update({
    where: { id: clientScheme.id },
    data: { currentVersionId: clientSchemeVersion.id, status: "published" },
  });

  const ruleIds = [globalRule.id, clientRule.id, clientDraftRule.id];
  const schemeIds = [globalScheme.id, clientScheme.id];

  async function cleanup() {
    const schemeVersionIds = (
      await testDb.validationSchemeVersion.findMany({ where: { schemeId: { in: schemeIds } }, select: { id: true } })
    ).map((v) => v.id);
    await testDb.validationSchemeRule.deleteMany({ where: { schemeVersionId: { in: schemeVersionIds } } });
    await testDb.validationScheme.updateMany({ where: { id: { in: schemeIds } }, data: { currentVersionId: null } });
    await testDb.validationSchemeVersion.deleteMany({ where: { schemeId: { in: schemeIds } } });
    await testDb.validationScheme.deleteMany({ where: { id: { in: schemeIds } } });

    await testDb.validationRule.updateMany({ where: { id: { in: ruleIds } }, data: { currentVersionId: null } });
    await testDb.validationRuleVersion.deleteMany({ where: { ruleId: { in: ruleIds } } });
    await testDb.validationRule.deleteMany({ where: { id: { in: ruleIds } } });
  }

  return {
    suffix: s,
    globalRule,
    globalRuleVersion,
    clientRule,
    clientRuleVersion,
    clientDraftRule,
    clientDraftRuleVersion,
    globalScheme,
    globalSchemeVersion,
    clientScheme,
    clientSchemeVersion,
    cleanup,
  };
}

export type RuleFixtures = Awaited<ReturnType<typeof buildRuleFixtures>>;
