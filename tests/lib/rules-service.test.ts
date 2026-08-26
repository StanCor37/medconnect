import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import {
  createDraftRuleService,
  createNextDraftVersionService,
  updateDraftVersionService,
  publishRuleVersionService,
  archiveRuleService,
  promoteRuleToGlobalService,
  deleteRuleService,
  RuleServiceError,
} from "@/lib/rules/service";
import type { CreateRuleInput } from "@/lib/validation/rule";

// Every field-path is unique-per-call by default so independent tests never
// collide via the probable-match heuristic once an earlier test's rule gets
// published (the duplicate search pool only includes PUBLISHED global rules
// per spec §9 — several tests below publish one as part of their own flow).
function baseInput(overrides: Partial<CreateRuleInput> = {}): CreateRuleInput {
  const suffix = uniqueSuffix();
  return {
    scope: "global", // deliberately "lied" in some tests below — the service must override this
    name: `Test Rule ${suffix}`,
    category: "document_requirement",
    executionType: "deterministic",
    definition: { operation: "required_field", parameters: { fieldPath: `invoice.field_${suffix}` } },
    applicability: {},
    providerMessageCode: "test_code",
    adminMessageCode: "test_code",
    severity: "blocking",
    hitlPolicy: "never",
    ...overrides,
  };
}

describe("rules/service", () => {
  let fx: Fixtures;
  const createdRuleIds: string[] = [];

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await testDb.validationSchemeRule.deleteMany({ where: { ruleVersion: { ruleId: { in: createdRuleIds } } } });
    await testDb.validationRule.updateMany({ where: { id: { in: createdRuleIds } }, data: { currentVersionId: null } });
    await testDb.validationRuleVersion.deleteMany({ where: { ruleId: { in: createdRuleIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "ValidationRule", targetId: { in: createdRuleIds } } });
    await testDb.validationRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    await fx.cleanup();
  });

  it("ownership is never trusted from the request: a Client Admin cannot lie their way to scope:global", async () => {
    const result = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("clientAdminA"), baseInput({ scope: "global" }))
    );
    createdRuleIds.push(result.rule.id);
    expect(result.rule.scope).toBe("client");
    expect(result.rule.clientId).toBe(fx.clientA.id);
  });

  it("Super Admin creating a rule always gets scope:global regardless of input", async () => {
    const result = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ scope: "client" }))
    );
    createdRuleIds.push(result.rule.id);
    expect(result.rule.scope).toBe("global");
    expect(result.rule.clientId).toBeNull();
  });

  it("exact-match duplicate is blocked", async () => {
    const name = `Exact Dup ${uniqueSuffix()}`;
    // category is unique to this test so it never collides with the
    // probable-match test's published rule or with the default-shaped
    // rules created by unrelated tests further down this file.
    const input = baseInput({
      name,
      category: "document_requirement",
      definition: { operation: "required_field", parameters: { fieldPath: "invoice.exact_dup_field" } },
    });
    const first = await testDb.$transaction((tx) => createDraftRuleService(tx, fx.authFor("superAdmin"), input));
    createdRuleIds.push(first.rule.id);
    // The duplicate search pool only includes PUBLISHED global rules
    // (spec §9) — "first" must be published before it can be matched.
    await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), first.rule.id, first.rule.currentVersionId!, first.rule.version)
    );

    await expect(
      testDb.$transaction((tx) => createDraftRuleService(tx, fx.authFor("superAdmin"), input))
    ).rejects.toMatchObject({ code: "duplicate_rule" });
  });

  it("probable-match duplicate warns, then succeeds with confirmedNotDuplicateBy", async () => {
    // category is unique to this test (financial_validation) so it never
    // collides with the exact-match test's rule or any other test's default.
    const category = "financial_validation" as const;
    const first = await testDb.$transaction((tx) =>
      createDraftRuleService(
        tx,
        fx.authFor("superAdmin"),
        baseInput({
          category,
          name: `Probable Base ${uniqueSuffix()}`,
          definition: { operation: "amount_greater_than", parameters: { amountPath: "invoice.total", thresholdValue: 100 } },
        })
      )
    );
    createdRuleIds.push(first.rule.id);
    // Search pool is PUBLISHED global rules only — publish before matching.
    await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), first.rule.id, first.rule.currentVersionId!, first.rule.version)
    );

    await expect(
      testDb.$transaction((tx) =>
        createDraftRuleService(
          tx,
          fx.authFor("superAdmin"),
          baseInput({
            category,
            name: `Probable Variant ${uniqueSuffix()}`,
            definition: { operation: "amount_greater_than", parameters: { amountPath: "invoice.total", thresholdValue: 500 } },
          })
        )
      )
    ).rejects.toMatchObject({ code: "probable_duplicate_rule" });

    const overridden = await testDb.$transaction((tx) =>
      createDraftRuleService(
        tx,
        fx.authFor("superAdmin"),
        baseInput({
          category,
          name: `Probable Variant ${uniqueSuffix()}`,
          definition: { operation: "amount_greater_than", parameters: { amountPath: "invoice.total", thresholdValue: 500 } },
          confirmedNotDuplicateBy: fx.superAdmin.id,
        })
      )
    );
    createdRuleIds.push(overridden.rule.id);

    const overrideEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "ValidationRule", targetId: overridden.rule.id, eventType: "rule_duplicate_warning_overridden" },
    });
    expect(overrideEvent).not.toBeNull();
  });

  it("publishRuleVersionService returns the POST-mutation object (regression: stale-return bug class)", async () => {
    const created = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "field_extraction" }))
    );
    createdRuleIds.push(created.rule.id);

    const published = await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), created.rule.id, created.rule.currentVersionId!, created.rule.version)
    );
    expect(published.status).toBe("published");
    expect(published.currentVersionId).toBe(created.rule.currentVersionId);
  });

  it("createNextDraftVersionService leaves currentVersionId/status untouched until the new version publishes", async () => {
    const created = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "data_consistency" }))
    );
    createdRuleIds.push(created.rule.id);
    const published = await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), created.rule.id, created.rule.currentVersionId!, created.rule.version)
    );

    const nextDraft = await testDb.$transaction((tx) =>
      createNextDraftVersionService(tx, fx.authFor("superAdmin"), created.rule.id, published.version)
    );
    expect(nextDraft.publishedAt).toBeNull();
    expect(nextDraft.versionNumber).toBe(2);

    const ruleAfter = await testDb.validationRule.findUniqueOrThrow({ where: { id: created.rule.id } });
    expect(ruleAfter.currentVersionId).toBe(published.currentVersionId); // still the OLD published version
    expect(ruleAfter.status).toBe("published");
  });

  it("stale version is rejected on publish/archive, never silently overwritten", async () => {
    const created = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "date_validation" }))
    );
    createdRuleIds.push(created.rule.id);

    await expect(
      testDb.$transaction((tx) =>
        publishRuleVersionService(tx, fx.authFor("superAdmin"), created.rule.id, created.rule.currentVersionId!, 999)
      )
    ).rejects.toMatchObject({ code: "stale_version" });

    await expect(
      testDb.$transaction((tx) => archiveRuleService(tx, fx.authFor("superAdmin"), created.rule.id, 999))
    ).rejects.toMatchObject({ code: "stale_version" });
  });

  it("promotion creates an independent global rule, leaves the source unchanged, and never auto-publishes", async () => {
    const source = await testDb.$transaction((tx) =>
      createDraftRuleService(
        tx,
        fx.authFor("clientAdminA"),
        baseInput({ name: `Promote Source ${uniqueSuffix()}`, category: "medical_clause" })
      )
    );
    createdRuleIds.push(source.rule.id);
    const published = await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("clientAdminA"), source.rule.id, source.rule.currentVersionId!, source.rule.version)
    );

    const beforeSnapshot = await testDb.validationRule.findUniqueOrThrow({ where: { id: source.rule.id } });

    const promoted = await testDb.$transaction((tx) =>
      promoteRuleToGlobalService(tx, fx.authFor("superAdmin"), source.rule.id, published.currentVersionId!, undefined)
    );
    createdRuleIds.push(promoted.id);

    expect(promoted.id).not.toBe(source.rule.id);
    expect(promoted.scope).toBe("global");
    expect(promoted.status).toBe("draft"); // never auto-published
    expect(promoted.sourceRuleId).toBe(source.rule.id);

    const afterSnapshot = await testDb.validationRule.findUniqueOrThrow({ where: { id: source.rule.id } });
    expect(afterSnapshot).toEqual(beforeSnapshot); // byte-for-byte unchanged
  });

  it("deleteRuleService hard-deletes a zero-activity draft, falls back to archive for a published+referenced rule", async () => {
    const draft = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "fraud_indicator" }))
    );
    const result = await testDb.$transaction((tx) => deleteRuleService(tx, fx.authFor("superAdmin"), draft.rule.id));
    expect(result.hardDeleted).toBe(true);
    const gone = await testDb.validationRule.findUnique({ where: { id: draft.rule.id } });
    expect(gone).toBeNull();

    const published = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "fraud_indicator" }))
    );
    createdRuleIds.push(published.rule.id);
    await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), published.rule.id, published.rule.currentVersionId!, published.rule.version)
    );
    const fallback = await testDb.$transaction((tx) => deleteRuleService(tx, fx.authFor("superAdmin"), published.rule.id));
    expect(fallback.hardDeleted).toBe(false);
    const archived = await testDb.validationRule.findUniqueOrThrow({ where: { id: published.rule.id } });
    expect(archived.status).toBe("archived");
  });

  it("a non-admin role cannot create a Rule", async () => {
    await expect(
      testDb.$transaction((tx) => createDraftRuleService(tx, fx.authFor("providerUserStandalone"), baseInput()))
    ).rejects.toBeInstanceOf(RuleServiceError);
  });

  it("regression: a next-draft version (created while a prior version is still current+published) can actually be edited before publish, without disturbing the live version", async () => {
    const created = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "medical_clause" }))
    );
    createdRuleIds.push(created.rule.id);
    const v1Published = await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), created.rule.id, created.rule.currentVersionId!, created.rule.version)
    );
    const v1Name = v1Published.name;

    const v2Draft = await testDb.$transaction((tx) =>
      createNextDraftVersionService(tx, fx.authFor("superAdmin"), created.rule.id, v1Published.version)
    );
    expect(v2Draft.publishedAt).toBeNull();

    // Before the fix, this threw invalid_state ("Only the current draft
    // version can be edited") because v2Draft.id !== rule.currentVersionId
    // (still v1's id) — the exact bug this test guards against.
    const ruleAfterNextDraft = await testDb.validationRule.findUniqueOrThrow({ where: { id: created.rule.id } });
    const v2Edited = await testDb.$transaction((tx) =>
      updateDraftVersionService(tx, fx.authFor("superAdmin"), created.rule.id, v2Draft.id, ruleAfterNextDraft.version, {
        version: ruleAfterNextDraft.version,
        name: `${v1Name} v2 edited`,
        providerMessageCode: "v2_edited_code",
      })
    );
    expect(v2Edited.name).toBe(`${v1Name} v2 edited`);
    expect(v2Edited.providerMessageCode).toBe("v2_edited_code");

    // Editing the future draft must NOT retroactively change what's live —
    // Rule.name/currentVersionId still reflect v1 until v2 is published.
    const ruleStillOnV1 = await testDb.validationRule.findUniqueOrThrow({ where: { id: created.rule.id } });
    expect(ruleStillOnV1.currentVersionId).toBe(v1Published.currentVersionId);
    expect(ruleStillOnV1.name).toBe(v1Name);

    // A versionId belonging to a DIFFERENT Rule must still be rejected —
    // proving the ruleId scoping added alongside this fix actually holds.
    const otherRule = await testDb.$transaction((tx) =>
      createDraftRuleService(tx, fx.authFor("superAdmin"), baseInput({ category: "financial_validation" }))
    );
    createdRuleIds.push(otherRule.rule.id);
    await expect(
      testDb.$transaction((tx) =>
        updateDraftVersionService(tx, fx.authFor("superAdmin"), otherRule.rule.id, v2Draft.id, otherRule.rule.version, {
          version: otherRule.rule.version,
          name: "should not be allowed",
        })
      )
    ).rejects.toMatchObject({ code: "invalid_state" });

    // Publishing v2 now correctly promotes the edited content to live.
    const published = await testDb.$transaction((tx) =>
      publishRuleVersionService(tx, fx.authFor("superAdmin"), created.rule.id, v2Draft.id, ruleStillOnV1.version)
    );
    expect(published.name).toBe(`${v1Name} v2 edited`);
    expect(published.currentVersionId).toBe(v2Draft.id);
  });
});
