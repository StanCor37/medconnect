import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { buildRuleFixtures, type RuleFixtures } from "../setup/ruleFixtures";
import { scopedRuleWhere, scopedSchemeWhere } from "@/lib/rules/scoping";

describe("scopedRuleWhere / scopedSchemeWhere", () => {
  let fx: Fixtures;
  let rfx: RuleFixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
    rfx = await buildRuleFixtures(fx);
  });

  afterAll(async () => {
    await rfx.cleanup();
    await fx.cleanup();
  });

  async function visibleRuleIds(auth: ReturnType<Fixtures["authFor"]>) {
    const rows = await testDb.validationRule.findMany({
      where: {
        AND: [{ id: { in: [rfx.globalRule.id, rfx.clientRule.id, rfx.clientDraftRule.id] } }, scopedRuleWhere(auth)],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id).sort();
  }

  it("published global rule is visible to every role", async () => {
    for (const role of ["superAdmin", "clientAdminA", "clientAdminB", "providerUserStandalone", "providerUserConnected"] as const) {
      const ids = await visibleRuleIds(fx.authFor(role));
      expect(ids).toContain(rfx.globalRule.id);
    }
  });

  it("Super Admin sees Client A's rule for governance, including its draft", async () => {
    const ids = await visibleRuleIds(fx.authFor("superAdmin"));
    expect(ids).toContain(rfx.clientRule.id);
    expect(ids).toContain(rfx.clientDraftRule.id);
  });

  it("Client Admin A sees their own rule (any status, including draft)", async () => {
    const ids = await visibleRuleIds(fx.authFor("clientAdminA"));
    expect(ids).toContain(rfx.clientRule.id);
    expect(ids).toContain(rfx.clientDraftRule.id);
  });

  it("Client Admin B cannot see Client A's rules at all", async () => {
    const ids = await visibleRuleIds(fx.authFor("clientAdminB"));
    expect(ids).not.toContain(rfx.clientRule.id);
    expect(ids).not.toContain(rfx.clientDraftRule.id);
  });

  it("the actively-connected Provider User sees Client A's PUBLISHED rule but not the draft", async () => {
    const ids = await visibleRuleIds(fx.authFor("providerUserConnected"));
    expect(ids).toContain(rfx.clientRule.id);
    expect(ids).not.toContain(rfx.clientDraftRule.id);
  });

  it("the standalone Provider User cannot see Client A's rules at all", async () => {
    const ids = await visibleRuleIds(fx.authFor("providerUserStandalone"));
    expect(ids).not.toContain(rfx.clientRule.id);
    expect(ids).not.toContain(rfx.clientDraftRule.id);
  });

  async function visibleSchemeIds(auth: ReturnType<Fixtures["authFor"]>) {
    const rows = await testDb.validationScheme.findMany({
      where: { AND: [{ id: { in: [rfx.globalScheme.id, rfx.clientScheme.id] } }, scopedSchemeWhere(auth)] },
      select: { id: true },
    });
    return rows.map((r) => r.id).sort();
  }

  it("published global scheme visible to everyone; Client A scheme only to Client A and its connected Provider", async () => {
    const superIds = await visibleSchemeIds(fx.authFor("superAdmin"));
    expect(superIds).toEqual([rfx.globalScheme.id, rfx.clientScheme.id].sort());

    const adminAIds = await visibleSchemeIds(fx.authFor("clientAdminA"));
    expect(adminAIds).toEqual([rfx.globalScheme.id, rfx.clientScheme.id].sort());

    const adminBIds = await visibleSchemeIds(fx.authFor("clientAdminB"));
    expect(adminBIds).toEqual([rfx.globalScheme.id]);

    const connectedIds = await visibleSchemeIds(fx.authFor("providerUserConnected"));
    expect(connectedIds).toEqual([rfx.globalScheme.id, rfx.clientScheme.id].sort());

    const standaloneIds = await visibleSchemeIds(fx.authFor("providerUserStandalone"));
    expect(standaloneIds).toEqual([rfx.globalScheme.id]);
  });
});
