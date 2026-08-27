import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../../setup/testDb";
import { buildFixtures, type Fixtures } from "../../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../../setup/documentFixtures";
import { buildValidationFixtures, createConfirmedDocument, type ValidationFixtures } from "../../setup/validationFixtures";
import { FakeAiRuleEvaluator, fakeAiRuleResult } from "../../setup/fakeAiRuleEvaluator";
import { startValidationRunService } from "@/lib/validation/engine/service";
import { decideHitlTaskService, HitlServiceError } from "@/lib/hitl/service";

describe("validation engine — Segment 7", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  let vfx: ValidationFixtures;
  const extraCaseIds: string[] = [];

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);
    vfx = await buildValidationFixtures(fx, dfx);
  });

  afterAll(async () => {
    // dfx.pendingRelationshipCase is used directly (not via createConnectedCase)
    // by one test — its ValidationRun/etc rows must be cleaned up here too,
    // before dfx.cleanup() deletes the Case itself and vfx.cleanup() deletes
    // the ValidationRuleVersions these rows reference (both would otherwise
    // hit a foreign-key-constraint error, since neither cascade-deletes).
    const validationCaseIds = [...extraCaseIds, dfx.pendingRelationshipCase.id];
    await testDb.hitlDecision.deleteMany({ where: { hitlTask: { caseId: { in: validationCaseIds } } } });
    await testDb.hitlTask.deleteMany({ where: { caseId: { in: validationCaseIds } } });
    await testDb.validationRuleResult.deleteMany({ where: { caseId: { in: validationCaseIds } } });
    await testDb.requirementResult.deleteMany({ where: { caseId: { in: validationCaseIds } } });
    await testDb.validationRun.updateMany({ where: { caseId: { in: validationCaseIds } }, data: { supersedesValidationRunId: null } });
    await testDb.validationRun.deleteMany({ where: { caseId: { in: validationCaseIds } } });

    if (extraCaseIds.length > 0) {
      await testDb.caseStatusHistory.deleteMany({ where: { caseId: { in: extraCaseIds } } });
      await testDb.extractedField.deleteMany({ where: { caseId: { in: extraCaseIds } } });
      await testDb.document.updateMany({ where: { caseId: { in: extraCaseIds } }, data: { currentVersionId: null } });
      await testDb.documentVersion.deleteMany({ where: { document: { caseId: { in: extraCaseIds } } } });
      await testDb.document.deleteMany({ where: { caseId: { in: extraCaseIds } } });
      await testDb.sourceFile.deleteMany({ where: { caseId: { in: extraCaseIds } } });
      await testDb.case.deleteMany({ where: { id: { in: extraCaseIds } } });
    }
    await vfx.cleanup();
    await dfx.cleanup();
    await fx.cleanup();
  });

  /** Every test gets its OWN Case — caching/revalidation are core engine behaviors, so sharing a Case across tests would let one test's cached results silently leak into another's. */
  async function createConnectedCase() {
    const c = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-ENGINE-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        caseMode: "client_connected",
        providerId: fx.providerConnected.id,
        createdByUserId: fx.providerUserConnected.id,
        clientId: fx.clientA.id,
        providerClientRelationshipId: fx.activeRelationship.id,
        validationSchemeVersionId: dfx.schemeVersion.id,
        // Segment 8's state machine only allows "validating" from a handful
        // of statuses — these Cases are created directly (bypassing the
        // document-upload lifecycle that would otherwise progress them
        // there), so they're seeded already-ready for the engine tests below.
        status: "ready_for_validation",
      },
    });
    extraCaseIds.push(c.id);
    return c;
  }

  it("with nothing uploaded yet: incomplete, and missing documents never appear as a failed rule", async () => {
    const caseRow = await createConnectedCase();
    const fakeAi = new FakeAiRuleEvaluator();
    const run = await testDb.$transaction((tx) =>
      startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi })
    );

    expect(run.overallResult).toBe("incomplete");
    expect(run.requirementResults.some((r) => r.requirementType === "document" && r.documentTypeCode === "invoice" && r.status === "missing")).toBe(true);
    expect(run.requirementResults.some((r) => r.requirementType === "document" && r.documentTypeCode === "medical_report" && r.status === "missing")).toBe(true);
    const deterministicResult = run.ruleResults.find((r) => r.ruleVersionId === vfx.deterministicRuleVersion.id)!;
    expect(deterministicResult.outcome).not.toBe("fail");
    expect(fakeAi.calls).toHaveLength(0);

    // Segment 8 §10 mapping: "incomplete" lands the Case back on
    // documents_in_progress, not left sitting on "validating".
    const caseAfter = await testDb.case.findUniqueOrThrow({ where: { id: caseRow.id } });
    expect(caseAfter.status).toBe("documents_in_progress");
  });

  it("pins exact Scheme/Case/Rule versions on the run", async () => {
    const caseRow = await createConnectedCase();
    const fakeAi = new FakeAiRuleEvaluator();
    const run = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));
    expect(run.schemeVersionId).toBe(dfx.schemeVersion.id);
    // +1: startValidationRunService's own first act is transitioning the
    // Case to "validating" (Segment 8), which bumps version before the run
    // row (and its casePinnedVersion snapshot) is created.
    expect(run.casePinnedVersion).toBe(caseRow.version + 1);
    expect(run.ruleResults.every((r) => r.validationRunId === run.id)).toBe(true);
  });

  it("both documents present: deterministic runs before AI, AI gate passes, needs_review creates a HITL task, overall result is needs_client_review", async () => {
    const caseRow = await createConnectedCase();
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 12000, currency: "EUR" } },
    ]);
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "medical_report");

    const fakeAi = new FakeAiRuleEvaluator([fakeAiRuleResult("needs_review", 0.9)]);
    const run = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));

    expect(fakeAi.calls).toHaveLength(1);
    const deterministicResult = run.ruleResults.find((r) => r.ruleVersionId === vfx.deterministicRuleVersion.id)!;
    expect(deterministicResult.outcome).toBe("pass");
    const aiResult = run.ruleResults.find((r) => r.ruleVersionId === vfx.aiRuleVersion.id)!;
    expect(aiResult.outcome).toBe("needs_review");
    expect(aiResult.completedAt!.getTime()).toBeGreaterThanOrEqual(deterministicResult.completedAt!.getTime());

    expect(run.hitlTasks).toHaveLength(1);
    expect(run.hitlTasks[0].assignedClientId).toBe(fx.clientA.id);
    expect(run.overallResult).toBe("needs_client_review");

    // Segment 8 §10 mapping: needs_client_review -> client_review_required.
    const caseAfter = await testDb.case.findUniqueOrThrow({ where: { id: caseRow.id } });
    expect(caseAfter.status).toBe("client_review_required");
  });

  it("a technical AI failure is processing_error, never fail — technical errors are not insurance failures", async () => {
    const caseRow = await createConnectedCase();
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 5000, currency: "EUR" } },
    ]);
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "medical_report");

    const fakeAi = new FakeAiRuleEvaluator([{ error: "model_timeout" }]);
    const run = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));

    const aiResult = run.ruleResults.find((r) => r.ruleVersionId === vfx.aiRuleVersion.id)!;
    expect(aiResult.outcome).toBe("processing_error");
    expect(aiResult.technicalErrorCode).toBe("model_timeout");
    expect(run.status).toBe("partially_completed");
  });

  it("standalone Cases never create a Client HITL task, even for a needs_review outcome", async () => {
    const standaloneWithScheme = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-STANDALONE-HITL-${Date.now()}`,
        caseMode: "standalone",
        providerId: fx.providerStandalone.id,
        createdByUserId: fx.providerUserStandalone.id,
        validationSchemeVersionId: dfx.schemeVersion.id,
        status: "ready_for_validation",
      },
    });
    extraCaseIds.push(standaloneWithScheme.id);
    await createConfirmedDocument(standaloneWithScheme, fx.providerUserStandalone.id, "medical_report");
    await createConfirmedDocument(standaloneWithScheme, fx.providerUserStandalone.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 1000, currency: "EUR" } },
    ]);

    const fakeAi = new FakeAiRuleEvaluator([fakeAiRuleResult("needs_review")]);
    const run = await testDb.$transaction((tx) =>
      startValidationRunService(tx, fx.authFor("providerUserStandalone"), standaloneWithScheme.id, "provider_started", { aiRuleEvaluator: fakeAi })
    );

    expect(run.hitlTasks).toHaveLength(0);
    // The AI rule here is `warning` severity, not `blocking` — a non-blocking
    // needs_review outcome resolves to passed_with_warnings regardless of
    // caseMode; only a BLOCKING needs_review on a standalone Case escalates
    // to needs_provider_action (see overallResult.test.ts for that case
    // tested directly). What matters here is specifically the absence of any HitlTask.
    expect(run.overallResult).toBe("passed_with_warnings");

    // Segment 8 §10 mapping: passed_with_warnings -> validated_with_issues.
    const caseAfter = await testDb.case.findUniqueOrThrow({ where: { id: standaloneWithScheme.id } });
    expect(caseAfter.status).toBe("validated_with_issues");
  });

  it("revalidation: an unchanged snapshot reuses every result with zero new AI calls; a changed field only reruns the dependent rule", async () => {
    const caseRow = await createConnectedCase();
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "medical_report");
    const { version: invoiceVersion } = await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 7500, currency: "EUR" } },
    ]);

    const fakeAi = new FakeAiRuleEvaluator([fakeAiRuleResult("pass", 0.95)]);
    const firstRun = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));
    expect(fakeAi.calls).toHaveLength(1);

    const secondRun = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));
    expect(fakeAi.calls).toHaveLength(1); // still 1 — no new call for an unchanged snapshot
    expect(secondRun.trigger).toBe("provider_revalidated");
    expect(secondRun.ruleResults.every((r) => r.cached)).toBe(true);

    const firstRunRefetched = await testDb.validationRun.findUniqueOrThrow({ where: { id: firstRun.id }, include: { ruleResults: true } });
    expect(firstRunRefetched.status).toBe("superseded");
    for (const original of firstRun.ruleResults) {
      const stillThere = firstRunRefetched.ruleResults.find((r) => r.id === original.id)!;
      expect(stillThere.outcome).toBe(original.outcome);
      expect(stillThere.reasonCode).toBe(original.reasonCode);
      expect(stillThere.superseded).toBe(true);
    }

    await testDb.extractedField.updateMany({
      where: { documentVersionId: invoiceVersion.id },
      data: { confirmedValue: { minorUnits: 9999, currency: "EUR" } },
    });
    const thirdRun = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));
    expect(fakeAi.calls).toHaveLength(1); // still no new AI call
    const thirdDeterministic = thirdRun.ruleResults.find((r) => r.ruleVersionId === vfx.deterministicRuleVersion.id)!;
    const thirdAi = thirdRun.ruleResults.find((r) => r.ruleVersionId === vfx.aiRuleVersion.id)!;
    expect(thirdDeterministic.cached).toBe(false);
    expect(thirdAi.cached).toBe(true);
  });

  it("HITL decision: overriding without a reason is rejected; automated outcome is never mutated by a decision; stale version is rejected", async () => {
    const caseRow = await createConnectedCase();
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "medical_report");
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 3000, currency: "EUR" } },
    ]);
    const fakeAi = new FakeAiRuleEvaluator([fakeAiRuleResult("needs_review", 0.8)]);
    const run = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));
    const task = run.hitlTasks[0];
    const originalRuleResult = run.ruleResults.find((r) => r.id === task.ruleResultId)!;

    await expect(
      testDb.$transaction((tx) =>
        decideHitlTaskService(tx, fx.authFor("clientAdminA"), task.id, { version: task.version, decision: "override_to_pass" } as never)
      )
    ).rejects.toThrow(HitlServiceError);

    const decided = await testDb.$transaction((tx) =>
      decideHitlTaskService(tx, fx.authFor("clientAdminA"), task.id, { version: task.version, decision: "override_to_pass", reason: "Reviewed manually, condition is covered" })
    );
    expect(decided.status).toBe("resolved");
    expect(decided.decisions).toHaveLength(1);
    expect(decided.decisions[0].automatedOutcome).toBe(originalRuleResult.outcome);

    const ruleResultAfter = await testDb.validationRuleResult.findUniqueOrThrow({ where: { id: task.ruleResultId } });
    expect(ruleResultAfter.outcome).toBe(originalRuleResult.outcome);

    await expect(
      testDb.$transaction((tx) => decideHitlTaskService(tx, fx.authFor("clientAdminA"), task.id, { version: task.version, decision: "confirm" }))
    ).rejects.toThrow(HitlServiceError);
  });

  it("a pending (not-yet-active) relationship never creates a Client HITL task at all — spec §29's active-relationship requirement enforced at creation", async () => {
    await createConfirmedDocument(dfx.pendingRelationshipCase, fx.providerUserConnected.id, "medical_report");
    await createConfirmedDocument(dfx.pendingRelationshipCase, fx.providerUserConnected.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 4200, currency: "EUR" } },
    ]);
    await testDb.case.update({
      where: { id: dfx.pendingRelationshipCase.id },
      data: { validationSchemeVersionId: dfx.schemeVersion.id, status: "ready_for_validation" },
    });

    const fakeAi = new FakeAiRuleEvaluator([fakeAiRuleResult("needs_review")]);
    const run = await testDb.$transaction((tx) =>
      startValidationRunService(tx, fx.authFor("providerUserConnected"), dfx.pendingRelationshipCase.id, "provider_started", { aiRuleEvaluator: fakeAi })
    );
    expect(run.hitlTasks).toHaveLength(0);
    expect(run.overallResult).toBe("passed_with_warnings"); // no active Client relationship to route the (non-blocking) review to — see the standalone test's comment on severity

    await testDb.case.update({ where: { id: dfx.pendingRelationshipCase.id }, data: { validationSchemeVersionId: null, status: "draft" } });
  });

  it("a Client Admin from a different Client cannot decide someone else's HITL task", async () => {
    const caseRow = await createConnectedCase();
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "medical_report");
    await createConfirmedDocument(caseRow, fx.providerUserConnected.id, "invoice", [
      { fieldDefinitionId: vfx.totalCostField.id, valueType: "money", confirmedValue: { minorUnits: 1500, currency: "EUR" } },
    ]);
    const fakeAi = new FakeAiRuleEvaluator([fakeAiRuleResult("needs_review")]);
    const run = await testDb.$transaction((tx) => startValidationRunService(tx, fx.authFor("providerUserConnected"), caseRow.id, "provider_started", { aiRuleEvaluator: fakeAi }));
    expect(run.hitlTasks.length).toBeGreaterThan(0);
    const task = run.hitlTasks[0];

    await expect(
      testDb.$transaction((tx) => decideHitlTaskService(tx, fx.authFor("clientAdminB"), task.id, { version: task.version, decision: "confirm" }))
    ).rejects.toThrow(HitlServiceError);
  });
});
