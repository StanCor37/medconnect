import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { createDraftRuleService, publishRuleVersionService } from "@/lib/rules/service";
import {
  createDraftSchemeService,
  addRuleToSchemeService,
  publishSchemeVersionService,
  archiveSchemeService,
  addDocumentTypeToSchemeService,
  updateDocumentTypeDefinitionService,
  removeDocumentTypeFromSchemeService,
  createNextDraftSchemeVersionService,
  SchemeServiceError,
} from "@/lib/schemes/service";
import { createCaseService, assignSchemeVersionService } from "@/lib/cases/service";
import type { CreateRuleInput } from "@/lib/validation/rule";

describe("schemes/service", () => {
  let fx: Fixtures;
  const createdRuleIds: string[] = [];
  const createdSchemeIds: string[] = [];
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await testDb.case.updateMany({ where: { id: { in: createdCaseIds } }, data: { validationSchemeVersionId: null } });
    await testDb.idempotencyKey.deleteMany({ where: { caseId: { in: createdCaseIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "Case", targetId: { in: createdCaseIds } } });
    await testDb.case.deleteMany({ where: { id: { in: createdCaseIds } } });

    await testDb.validationSchemeRule.deleteMany({ where: { schemeVersion: { schemeId: { in: createdSchemeIds } } } });
    await testDb.documentTypeDefinition.deleteMany({ where: { schemeVersion: { schemeId: { in: createdSchemeIds } } } });
    await testDb.validationScheme.updateMany({ where: { id: { in: createdSchemeIds } }, data: { currentVersionId: null } });
    await testDb.validationSchemeVersion.deleteMany({ where: { schemeId: { in: createdSchemeIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "ValidationScheme", targetId: { in: createdSchemeIds } } });
    await testDb.validationScheme.deleteMany({ where: { id: { in: createdSchemeIds } } });

    await testDb.validationSchemeRule.deleteMany({ where: { ruleVersion: { ruleId: { in: createdRuleIds } } } });
    await testDb.validationRule.updateMany({ where: { id: { in: createdRuleIds } }, data: { currentVersionId: null } });
    await testDb.validationRuleVersion.deleteMany({ where: { ruleId: { in: createdRuleIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "ValidationRule", targetId: { in: createdRuleIds } } });
    await testDb.validationRule.deleteMany({ where: { id: { in: createdRuleIds } } });

    await fx.cleanup();
  });

  /** Creates and publishes a rule as the given actor. Each call uses its own category so independent rules never collide via the probable-match duplicate check. */
  async function publishedRule(
    actorKey: "superAdmin" | "clientAdminA" | "clientAdminB",
    overrides: Partial<CreateRuleInput> = {}
  ) {
    const suffix = uniqueSuffix();
    const created = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor(actorKey), {
        scope: "global",
        name: `Scheme Test Rule ${suffix}`,
        category: "document_requirement",
        executionType: "deterministic",
        definition: { operation: "required_field", parameters: { fieldPath: `invoice.field_${suffix}` } },
        applicability: {},
        providerMessageCode: "test_code",
        adminMessageCode: "test_code",
        severity: "blocking",
        hitlPolicy: "never",
        ...overrides,
      })
    );
    createdRuleIds.push(created.rule.id);
    const published = await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor(actorKey), created.rule.id, created.rule.currentVersionId!, created.rule.version)
    );
    return published; // Rule row; .currentVersionId is the published ValidationRuleVersion id.
  }

  it("addRuleToSchemeService accepts global and own-Client rules on a Client scheme, rejects another Client's rule", async () => {
    const globalRule = await publishedRule("superAdmin", { category: "eligibility" });
    const clientARule = await publishedRule("clientAdminA", { category: "medical_clause" });
    const clientBRule = await publishedRule("clientAdminB", { category: "fraud_indicator" });

    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("clientAdminA"), {
        scope: "client",
        name: `Client A Scheme ${uniqueSuffix()}`,
        countryCodes: [],
      })
    );
    createdSchemeIds.push(scheme.id);

    const afterGlobal = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("clientAdminA"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: globalRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );

    const afterOwn = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("clientAdminA"), scheme.id, afterGlobal.currentVersionId!, afterGlobal.version, {
        version: afterGlobal.version,
        ruleVersionId: clientARule.currentVersionId!,
        executionOrder: 1,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    expect(afterOwn.currentVersion?.schemeRules).toHaveLength(2);

    await expect(
      testDb.$transaction((tx) =>
        addRuleToSchemeService(tx, fx.authFor("clientAdminA"), scheme.id, afterOwn.currentVersionId!, afterOwn.version, {
          version: afterOwn.version,
          ruleVersionId: clientBRule.currentVersionId!,
          executionOrder: 2,
          parameters: {},
          enabled: true,
          required: true,
        })
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("addRuleToSchemeService rejects any Client-owned rule on a global scheme, accepts a global rule", async () => {
    const globalRule = await publishedRule("superAdmin", { category: "financial_validation" });
    const clientARule = await publishedRule("clientAdminA", { category: "date_validation" });

    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), {
        scope: "global",
        name: `Global Scheme ${uniqueSuffix()}`,
        countryCodes: [],
      })
    );
    createdSchemeIds.push(scheme.id);

    await expect(
      testDb.$transaction((tx) =>
        addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
          version: scheme.version,
          ruleVersionId: clientARule.currentVersionId!,
          executionOrder: 0,
          parameters: {},
          enabled: true,
          required: true,
        })
      )
    ).rejects.toMatchObject({ code: "invalid_input" });

    const afterGlobal = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: globalRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    expect(afterGlobal.currentVersion?.schemeRules).toHaveLength(1);
  });

  it("assignSchemeVersionService: standalone Case only accepts a fully-global scheme; Client-connected Case accepts global or its own Client's scheme but rejects another Client's; audits assign then change", async () => {
    // Categories here (and across the other tests in this file) are each
    // used by at most one GLOBAL rule and at most one rule per Client — two
    // published global rules (or a client rule + a global rule) sharing a
    // category+operation always trigger the probable-match duplicate check
    // (see rules/service.ts), so cross-test category reuse across the same
    // scope must be avoided.
    const globalRule = await publishedRule("superAdmin", { category: "field_extraction" });
    const clientARule = await publishedRule("clientAdminA", { category: "document_requirement" });
    const clientBRule = await publishedRule("clientAdminB", { category: "document_requirement" });

    // Fully-global published scheme.
    const globalScheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Global Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(globalScheme.id);
    const globalSchemeWithRule = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), globalScheme.id, globalScheme.currentVersionId!, globalScheme.version, {
        version: globalScheme.version,
        ruleVersionId: globalRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const publishedGlobalScheme = await testDb.$transaction((tx) =>
      publishSchemeVersionService(
        tx,
        fx.authFor("superAdmin"),
        globalScheme.id,
        globalSchemeWithRule.currentVersionId!,
        globalSchemeWithRule.version
      )
    );

    // Published Client A scheme (mixes the global rule and Client A's own rule).
    const clientAScheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("clientAdminA"), { scope: "client", name: `Client A Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(clientAScheme.id);
    const clientASchemeWithGlobal = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("clientAdminA"), clientAScheme.id, clientAScheme.currentVersionId!, clientAScheme.version, {
        version: clientAScheme.version,
        ruleVersionId: globalRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const clientASchemeWithOwn = await testDb.$transaction((tx) =>
      addRuleToSchemeService(
        tx,
        fx.authFor("clientAdminA"),
        clientAScheme.id,
        clientASchemeWithGlobal.currentVersionId!,
        clientASchemeWithGlobal.version,
        {
          version: clientASchemeWithGlobal.version,
          ruleVersionId: clientARule.currentVersionId!,
          executionOrder: 1,
          parameters: {},
          enabled: true,
          required: true,
        }
      )
    );
    const publishedClientAScheme = await testDb.$transaction((tx) =>
      publishSchemeVersionService(
        tx,
        fx.authFor("clientAdminA"),
        clientAScheme.id,
        clientASchemeWithOwn.currentVersionId!,
        clientASchemeWithOwn.version
      )
    );

    // Published Client B scheme.
    const clientBScheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("clientAdminB"), { scope: "client", name: `Client B Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(clientBScheme.id);
    const clientBSchemeWithRule = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("clientAdminB"), clientBScheme.id, clientBScheme.currentVersionId!, clientBScheme.version, {
        version: clientBScheme.version,
        ruleVersionId: clientBRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const publishedClientBScheme = await testDb.$transaction((tx) =>
      publishSchemeVersionService(
        tx,
        fx.authFor("clientAdminB"),
        clientBScheme.id,
        clientBSchemeWithRule.currentVersionId!,
        clientBSchemeWithRule.version
      )
    );

    // Standalone Case: only a fully-global scheme is compatible.
    const standaloneCaseResult = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), { patientReference: `PT-STANDALONE-${uniqueSuffix()}` })
    );
    createdCaseIds.push(standaloneCaseResult.case.id);

    await expect(
      testDb.$transaction((tx) =>
        assignSchemeVersionService(
          tx,
          fx.authFor("providerUserStandalone"),
          standaloneCaseResult.case.id,
          publishedClientAScheme.currentVersionId!,
          standaloneCaseResult.case.version
        )
      )
    ).rejects.toMatchObject({ code: "incompatible_scheme" });

    const standaloneAssigned = await testDb.$transaction((tx) =>
      assignSchemeVersionService(
        tx,
        fx.authFor("providerUserStandalone"),
        standaloneCaseResult.case.id,
        publishedGlobalScheme.currentVersionId!,
        standaloneCaseResult.case.version
      )
    );
    expect(standaloneAssigned.validationSchemeVersionId).toBe(publishedGlobalScheme.currentVersionId);

    // Client-connected Case (Provider connected to Client A).
    const connectedCaseResult = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserConnected"), {
        clientId: fx.clientA.id,
        patientReference: `PT-CONNECTED-${uniqueSuffix()}`,
      })
    );
    createdCaseIds.push(connectedCaseResult.case.id);

    await expect(
      testDb.$transaction((tx) =>
        assignSchemeVersionService(
          tx,
          fx.authFor("providerUserConnected"),
          connectedCaseResult.case.id,
          publishedClientBScheme.currentVersionId!,
          connectedCaseResult.case.version
        )
      )
    ).rejects.toMatchObject({ code: "incompatible_scheme" });

    const firstAssign = await testDb.$transaction((tx) =>
      assignSchemeVersionService(
        tx,
        fx.authFor("providerUserConnected"),
        connectedCaseResult.case.id,
        publishedGlobalScheme.currentVersionId!,
        connectedCaseResult.case.version
      )
    );
    expect(firstAssign.validationSchemeVersionId).toBe(publishedGlobalScheme.currentVersionId);

    const secondAssign = await testDb.$transaction((tx) =>
      assignSchemeVersionService(
        tx,
        fx.authFor("providerUserConnected"),
        connectedCaseResult.case.id,
        publishedClientAScheme.currentVersionId!,
        firstAssign.version
      )
    );
    expect(secondAssign.validationSchemeVersionId).toBe(publishedClientAScheme.currentVersionId);

    const assignedEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "Case", targetId: connectedCaseResult.case.id, eventType: "case_scheme_assigned" },
    });
    const changedEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "Case", targetId: connectedCaseResult.case.id, eventType: "case_scheme_changed" },
    });
    expect(assignedEvent).not.toBeNull();
    expect(changedEvent).not.toBeNull();
  });

  it("archived-but-pinned-still-resolves: a Case's pinned scheme version survives archiving the parent Scheme, but a fresh assignment against it is rejected", async () => {
    const rule = await publishedRule("superAdmin", { category: "data_consistency" });

    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Archivable Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(scheme.id);
    const withRule = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: rule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const published = await testDb.$transaction((tx) =>
      publishSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, withRule.currentVersionId!, withRule.version)
    );

    const caseResult = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), { patientReference: `PT-PINNED-${uniqueSuffix()}` })
    );
    createdCaseIds.push(caseResult.case.id);
    const assigned = await testDb.$transaction((tx) =>
      assignSchemeVersionService(
        tx,
        fx.authFor("providerUserStandalone"),
        caseResult.case.id,
        published.currentVersionId!,
        caseResult.case.version
      )
    );
    expect(assigned.validationSchemeVersionId).toBe(published.currentVersionId);

    await testDb.$transaction((tx) => archiveSchemeService(tx, fx.authFor("superAdmin"), scheme.id, published.version));

    // The Case's pinned assignment still resolves — the FK is untouched, the
    // pinned version row is never deleted, only the parent Scheme's status changed.
    const caseAfterArchive = await testDb.case.findUniqueOrThrow({ where: { id: caseResult.case.id } });
    expect(caseAfterArchive.validationSchemeVersionId).toBe(published.currentVersionId);

    // A fresh assignment attempt against the now-archived-parent version is rejected.
    const otherCaseResult = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), { patientReference: `PT-PINNED-OTHER-${uniqueSuffix()}` })
    );
    createdCaseIds.push(otherCaseResult.case.id);
    await expect(
      testDb.$transaction((tx) =>
        assignSchemeVersionService(
          tx,
          fx.authFor("providerUserStandalone"),
          otherCaseResult.case.id,
          published.currentVersionId!,
          otherCaseResult.case.version
        )
      )
    ).rejects.toMatchObject({ code: "invalid_scheme_state" });
  });

  it("addDocumentTypeToSchemeService/updateDocumentTypeDefinitionService/removeDocumentTypeFromSchemeService are only legal on the current unpublished draft version", async () => {
    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Doc Type Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(scheme.id);

    const withType = await testDb.$transaction((tx) =>
      addDocumentTypeToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        code: "medical_report",
        name: "Medical report",
        description: undefined,
        acceptedMimeTypes: ["application/pdf"],
        required: true,
        multipleAllowed: false,
        expectedFields: [],
        classificationHints: [],
        captureGuidance: undefined,
        displayOrder: 0,
      })
    );
    const docType = withType.currentVersion!.documentTypeDefinitions[0];
    expect(docType.code).toBe("medical_report");
    expect(docType.required).toBe(true);

    const updated = await testDb.$transaction((tx) =>
      updateDocumentTypeDefinitionService(
        tx,
        fx.authFor("superAdmin"),
        scheme.id,
        withType.currentVersionId!,
        withType.version,
        docType.id,
        { version: withType.version, required: false }
      )
    );
    expect(updated.required).toBe(false);
    expect(updated.name).toBe("Medical report"); // untouched fields survive a partial update

    // updateDocumentTypeDefinitionService returns the DocumentTypeDefinition
    // row, not the parent Scheme, so the Scheme's post-update version is
    // tracked manually: it bumped by exactly 1 (same optimistic-concurrency
    // pattern as every other mutation in this file).
    const versionAfterUpdate = withType.version + 1;
    const withRemoved = await testDb.$transaction((tx) =>
      removeDocumentTypeFromSchemeService(
        tx,
        fx.authFor("superAdmin"),
        scheme.id,
        withType.currentVersionId!,
        versionAfterUpdate,
        docType.id
      )
    );
    expect(withRemoved.version).toBe(versionAfterUpdate + 1);

    const remainingTypes = await testDb.documentTypeDefinition.findMany({ where: { schemeVersionId: withType.currentVersionId! } });
    expect(remainingTypes).toHaveLength(0);
  });

  it("addDocumentTypeToSchemeService is rejected once the current version is published", async () => {
    // category+operation combos already used elsewhere in this file all
    // trigger the probable-match duplicate check (same category+executionType
    // +operation collides regardless of field path) — pick a fresh combo.
    const globalRule = await publishedRule("superAdmin", {
      category: "document_requirement",
      definition: { operation: "date_before", parameters: { datePath: "invoice.date", boundaryValue: "2026-01-01", inclusive: false } },
    });
    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Published Doc Type Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(scheme.id);
    const withRule = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: globalRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const published = await testDb.$transaction((tx) =>
      publishSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, withRule.currentVersionId!, withRule.version)
    );

    await expect(
      testDb.$transaction((tx) =>
        addDocumentTypeToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, published.currentVersionId!, published.version, {
          version: published.version,
          code: "invoice",
          name: "Invoice",
          description: undefined,
          acceptedMimeTypes: [],
          required: false,
          multipleAllowed: true,
          expectedFields: [],
          classificationHints: [],
          captureGuidance: undefined,
          displayOrder: 0,
        })
      )
    ).rejects.toBeInstanceOf(SchemeServiceError);
  });

  it("createNextDraftSchemeVersionService deep-copies Document Type definitions into the new draft version", async () => {
    const globalRule = await publishedRule("superAdmin", {
      category: "eligibility",
      definition: { operation: "amount_greater_than", parameters: { amountPath: "invoice.grand_total", thresholdValue: 1 } },
    });
    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Deep Copy Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(scheme.id);
    const withRule = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: globalRule.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const withType = await testDb.$transaction((tx) =>
      addDocumentTypeToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, withRule.currentVersionId!, withRule.version, {
        version: withRule.version,
        code: "referral",
        name: "Referral",
        description: undefined,
        acceptedMimeTypes: ["application/pdf"],
        required: false,
        multipleAllowed: true,
        expectedFields: [],
        classificationHints: [],
        captureGuidance: undefined,
        displayOrder: 0,
      })
    );
    const published = await testDb.$transaction((tx) =>
      publishSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, withType.currentVersionId!, withType.version)
    );

    const nextVersion = await testDb.$transaction((tx) =>
      createNextDraftSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, published.version)
    );

    const copiedTypes = await testDb.documentTypeDefinition.findMany({ where: { schemeVersionId: nextVersion.id } });
    expect(copiedTypes).toHaveLength(1);
    expect(copiedTypes[0].code).toBe("referral");
    expect(copiedTypes[0].id).not.toBe(withType.currentVersion!.documentTypeDefinitions?.[0]?.id);
  });

  it("regression: a next-draft scheme version (created while a prior version is still current+published) can actually have a Rule added before publish, without disturbing the live version", async () => {
    const ruleOne = await publishedRule("superAdmin", {
      category: "date_validation",
      definition: { operation: "date_after", parameters: { datePath: "invoice.date", boundaryValue: "2020-01-01", inclusive: true } },
    });
    const ruleTwo = await publishedRule("superAdmin", {
      category: "fraud_indicator",
      definition: { operation: "amount_less_than_or_equal", parameters: { amountPath: "invoice.total", thresholdValue: 100000 } },
    });

    const scheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Next Draft Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(scheme.id);
    const withRuleOne = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: ruleOne.currentVersionId!,
        executionOrder: 0,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    const v1Published = await testDb.$transaction((tx) =>
      publishSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, withRuleOne.currentVersionId!, withRuleOne.version)
    );

    const v2Draft = await testDb.$transaction((tx) =>
      createNextDraftSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, v1Published.version)
    );
    expect(v2Draft.publishedAt).toBeNull();
    const copiedIntoV2 = await testDb.validationSchemeRule.findMany({ where: { schemeVersionId: v2Draft.id } });
    expect(copiedIntoV2).toHaveLength(1); // deep-copied from v1 by createNextDraftSchemeVersionService

    // Before the fix, this threw invalid_state ("Rules can only be added to
    // the current unpublished draft version") because v2Draft.id !==
    // scheme.currentVersionId (still v1's id) — the exact bug this test
    // guards against.
    const schemeAfterNextDraft = await testDb.validationScheme.findUniqueOrThrow({ where: { id: scheme.id } });
    const v2WithSecondRule = await testDb.$transaction((tx) =>
      addRuleToSchemeService(tx, fx.authFor("superAdmin"), scheme.id, v2Draft.id, schemeAfterNextDraft.version, {
        version: schemeAfterNextDraft.version,
        ruleVersionId: ruleTwo.currentVersionId!,
        executionOrder: 1,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
    expect(v2WithSecondRule.currentVersion?.schemeRules).toHaveLength(2);

    // Editing the future draft must NOT retroactively change what's live —
    // the Scheme's currentVersionId still points at v1, still with only 1 Rule.
    const schemeStillOnV1 = await testDb.validationScheme.findUniqueOrThrow({ where: { id: scheme.id } });
    expect(schemeStillOnV1.currentVersionId).toBe(v1Published.currentVersionId);
    const v1RuleCount = await testDb.validationSchemeRule.count({ where: { schemeVersionId: v1Published.currentVersionId! } });
    expect(v1RuleCount).toBe(1);

    // A schemeVersionId belonging to a DIFFERENT Scheme must still be
    // rejected — proving the version.schemeId scoping added alongside this
    // fix actually holds.
    const otherScheme = await testDb.$transaction((tx) =>
      createDraftSchemeService(tx, fx.authFor("superAdmin"), { scope: "global", name: `Other Scheme ${uniqueSuffix()}`, countryCodes: [] })
    );
    createdSchemeIds.push(otherScheme.id);
    await expect(
      testDb.$transaction((tx) =>
        addRuleToSchemeService(tx, fx.authFor("superAdmin"), otherScheme.id, v2Draft.id, otherScheme.version, {
          version: otherScheme.version,
          ruleVersionId: ruleOne.currentVersionId!,
          executionOrder: 0,
          parameters: {},
          enabled: true,
          required: true,
        })
      )
    ).rejects.toMatchObject({ code: "not_found" });

    // Publishing v2 now correctly promotes the edited content to live.
    const published = await testDb.$transaction((tx) =>
      publishSchemeVersionService(tx, fx.authFor("superAdmin"), scheme.id, v2Draft.id, schemeStillOnV1.version)
    );
    expect(published.currentVersionId).toBe(v2Draft.id);
    const v2RuleCount = await testDb.validationSchemeRule.count({ where: { schemeVersionId: v2Draft.id } });
    expect(v2RuleCount).toBe(2);
  });
});
