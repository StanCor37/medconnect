import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../setup/documentFixtures";
import { buildValidationFixtures, type ValidationFixtures } from "../setup/validationFixtures";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";
import {
  getOpenCasesCount,
  getAcceptedCount,
  getHitlOutcomes,
  comparePeriod,
  bucketAge,
  safe,
} from "@/lib/analytics/overview";

describe("Segment 9 — Admin Monitoring and Analytics", () => {
  describe("authorization", () => {
    function ctx(role: "super_admin" | "client_admin" | "provider_user") {
      return {
        userId: "u1",
        role,
        providerId: role === "provider_user" ? "p1" : null,
        clientId: role === "client_admin" ? "c1" : null,
        accountStatus: "active" as const,
      };
    }

    it("Client Admin is allowed", () => {
      expect(can(ctx("client_admin"), "analytics.view", { type: "Analytics" }).allowed).toBe(true);
    });
    it("Provider User is denied with 403", () => {
      const decision = can(ctx("provider_user"), "analytics.view", { type: "Analytics" });
      expect(decision).toEqual({ allowed: false, status: 403 });
    });
    it("Super Admin is denied with 404 (pretends the dashboard doesn't exist)", () => {
      const decision = can(ctx("super_admin"), "analytics.view", { type: "Analytics" });
      expect(decision).toEqual({ allowed: false, status: 404 });
    });
  });

  describe("pure helpers", () => {
    it("comparePeriod never divides by zero — trend is null, not Infinity", () => {
      expect(comparePeriod(5, 0)).toEqual({ current: 5, previous: 0, trend: null });
      expect(comparePeriod(0, 0)).toEqual({ current: 0, previous: 0, trend: null });
      expect(comparePeriod(10, 5).trend).toBe(1);
      expect(comparePeriod(5, 10).trend).toBe(-0.5);
    });

    it("bucketAge places boundary values in the correct bucket", () => {
      const hour = 60 * 60 * 1000;
      const day = 24 * hour;
      expect(bucketAge(23 * hour)).toBe("<24h");
      expect(bucketAge(24 * hour + 1)).toBe("1-3d");
      expect(bucketAge(3 * day - 1)).toBe("1-3d");
      expect(bucketAge(3 * day + 1)).toBe("3-7d");
      expect(bucketAge(7 * day + 1)).toBe("7-14d");
      expect(bucketAge(14 * day + 1)).toBe("14-30d");
      expect(bucketAge(30 * day + 1)).toBe(">30d");
    });

    it("safe() isolates a thrown section without touching the caller", async () => {
      await expect(safe(async () => 42)).resolves.toBe(42);
      await expect(safe(async () => Promise.reject(new Error("boom")))).resolves.toEqual({ error: true });
    });
  });

  describe("scoping and aggregation against real data", () => {
    let fx: Fixtures;
    let dfx: DocumentFixtures;
    let vfx: ValidationFixtures;
    const extraCaseIds: string[] = [];
    const extraRunIds: string[] = [];
    const extraTaskIds: string[] = [];

    beforeAll(async () => {
      fx = await buildFixtures();
      dfx = await buildDocumentFixtures(fx);
      vfx = await buildValidationFixtures(fx, dfx);
    });

    afterAll(async () => {
      await testDb.hitlDecision.deleteMany({ where: { hitlTaskId: { in: extraTaskIds } } });
      await testDb.hitlTask.deleteMany({ where: { id: { in: extraTaskIds } } });
      await testDb.validationRuleResult.deleteMany({ where: { validationRunId: { in: extraRunIds } } });
      await testDb.validationRun.deleteMany({ where: { id: { in: extraRunIds } } });
      await testDb.case.deleteMany({ where: { id: { in: extraCaseIds } } });
      await vfx.cleanup();
      await dfx.cleanup();
      await fx.cleanup();
    });

    async function createCase(overrides: {
      clientId?: string | null;
      providerClientRelationshipId?: string | null;
      caseMode?: "standalone" | "client_connected";
      status?: string;
      insurerId?: string | null;
      createdAt?: Date;
      acceptedAt?: Date | null;
    }) {
      const c = await testDb.case.create({
        data: {
          internalReference: `MC-TEST-ANALYTICS-${uniqueSuffix()}`,
          caseMode: overrides.caseMode ?? "client_connected",
          providerId: fx.providerConnected.id,
          createdByUserId: fx.providerUserConnected.id,
          clientId: overrides.clientId ?? null,
          providerClientRelationshipId: overrides.providerClientRelationshipId ?? null,
          insurerId: overrides.insurerId ?? null,
          status: (overrides.status ?? "draft") as never,
          createdAt: overrides.createdAt ?? new Date(),
          acceptedAt: overrides.acceptedAt ?? null,
        },
      });
      extraCaseIds.push(c.id);
      return c;
    }

    async function scopedIdsFor(role: "clientAdminA" | "clientAdminB") {
      const rows = await testDb.case.findMany({ where: scopedCaseWhere(fx.authFor(role)), select: { id: true } });
      return rows.map((r) => r.id);
    }

    it("Client Admin's scoped Case IDs include only their own Client's actively-connected Cases", async () => {
      const ownCase1 = await createCase({ clientId: fx.clientA.id, providerClientRelationshipId: fx.activeRelationship.id });
      const ownCase2 = await createCase({ clientId: fx.clientA.id, providerClientRelationshipId: fx.activeRelationship.id });
      const otherClientCase = await createCase({ clientId: fx.clientB.id, providerClientRelationshipId: fx.pendingRelationship.id });

      const scopedIds = await scopedIdsFor("clientAdminA");
      expect(scopedIds).toContain(ownCase1.id);
      expect(scopedIds).toContain(ownCase2.id);
      expect(scopedIds).not.toContain(otherClientCase.id);
    });

    it("standalone Cases never appear in a Client Admin's scoped IDs, even with a recognized insurer set", async () => {
      const standalone = await createCase({ caseMode: "standalone", clientId: null, insurerId: fx.insurer.id });
      const scopedIds = await scopedIdsFor("clientAdminA");
      expect(scopedIds).not.toContain(standalone.id);
    });

    it("a Case on a pending (non-active) relationship is excluded from that Client's scoped IDs", async () => {
      const pendingCase = await createCase({ clientId: fx.clientB.id, providerClientRelationshipId: fx.pendingRelationship.id });
      const scopedIds = await scopedIdsFor("clientAdminB");
      expect(scopedIds).not.toContain(pendingCase.id);
    });

    it("Open Cases is a pure status snapshot — an old Case in an open status still counts, with no date range involved", async () => {
      const oldOpenCase = await createCase({
        clientId: fx.clientA.id,
        providerClientRelationshipId: fx.activeRelationship.id,
        status: "draft",
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      });
      const scopedIds = await scopedIdsFor("clientAdminA");
      const openCount = await testDb.$transaction((tx) => getOpenCasesCount(tx, scopedIds));
      expect(openCount).toBeGreaterThan(0);
      expect(scopedIds).toContain(oldOpenCase.id);
    });

    it("Accepted (period) only counts acceptances whose timestamp falls inside the requested window", async () => {
      const now = new Date();
      const longAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const recentAccept = await createCase({
        clientId: fx.clientA.id,
        providerClientRelationshipId: fx.activeRelationship.id,
        status: "accepted",
        acceptedAt: now,
      });
      const oldAccept = await createCase({
        clientId: fx.clientA.id,
        providerClientRelationshipId: fx.activeRelationship.id,
        status: "accepted",
        acceptedAt: longAgo,
      });
      const scopedIds = await scopedIdsFor("clientAdminA");
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const count = await testDb.$transaction((tx) => getAcceptedCount(tx, scopedIds, from, now));
      expect(scopedIds).toContain(recentAccept.id);
      expect(scopedIds).toContain(oldAccept.id);
      // Only recentAccept falls inside the last-30-days window.
      const acceptedInWindow = await testDb.case.count({
        where: { id: { in: scopedIds }, acceptedAt: { gte: from, lte: now } },
      });
      expect(count).toBe(acceptedInWindow);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("HITL override/confirmation rates are computed correctly against known decisions", async () => {
      const caseRow = await createCase({ clientId: fx.clientA.id, providerClientRelationshipId: fx.activeRelationship.id });
      const run = await testDb.validationRun.create({
        data: {
          caseId: caseRow.id,
          schemeVersionId: dfx.schemeVersion.id,
          runNumber: 1,
          status: "completed",
          overallResult: "needs_client_review",
          trigger: "provider_started",
          startedByUserId: fx.providerUserConnected.id,
          completedAt: new Date(),
          inputSnapshotHash: `hash-${uniqueSuffix()}`,
          casePinnedVersion: caseRow.version,
        },
      });
      extraRunIds.push(run.id);

      const decisions: ("confirm" | "override_to_pass" | "override_to_fail")[] = [
        "confirm",
        "confirm",
        "override_to_pass",
        "override_to_fail",
      ];
      for (const decision of decisions) {
        const ruleResult = await testDb.validationRuleResult.create({
          data: {
            validationRunId: run.id,
            caseId: caseRow.id,
            ruleVersionId: vfx.aiRuleVersion.id,
            outcome: "needs_review",
            severity: "warning",
            reasonCode: "test_ai_exclusion",
            inputReferences: [],
            evidenceReferences: [],
            inputSubsetHash: `hash-${uniqueSuffix()}`,
            executionType: "ai_assisted",
            executionEngine: "test",
            executionEngineVersion: "v1",
          },
        });
        const task = await testDb.hitlTask.create({
          data: {
            caseId: caseRow.id,
            validationRunId: run.id,
            ruleResultId: ruleResult.id,
            assignedClientId: fx.clientA.id,
            status: "resolved",
            reasonCode: "test_ai_exclusion",
            resolvedAt: new Date(),
            resolvedByUserId: fx.clientAdminA.id,
          },
        });
        extraTaskIds.push(task.id);
        await testDb.hitlDecision.create({
          data: {
            hitlTaskId: task.id,
            automatedOutcome: "needs_review",
            decision,
            reason: decision === "confirm" ? null : "test reason",
            decidedByUserId: fx.clientAdminA.id,
            decidedAt: new Date(),
          },
        });
      }

      const from = new Date(Date.now() - 60 * 60 * 1000);
      const to = new Date(Date.now() + 60 * 60 * 1000);
      const outcomes = await testDb.$transaction((tx) => getHitlOutcomes(tx, fx.authFor("clientAdminA"), from, to));
      expect(outcomes.totalDecisions).toBe(4);
      expect(outcomes.overrideRate).toBe(0.5);
      expect(outcomes.confirmationRate).toBe(0.5);
    });
  });
});
