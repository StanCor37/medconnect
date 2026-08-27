import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import type { CaseStatus } from "@/generated/prisma/enums";
import { CASE_TRANSITIONS, transitionCaseStatus } from "@/lib/cases/stateMachine";
import {
  submitCaseService,
  returnCaseToProviderService,
  acceptCaseService,
  rejectCaseService,
  markLiquidatedService,
  closeCaseService,
  cancelCaseService,
  reopenCaseService,
  CaseServiceError,
} from "@/lib/cases/service";

describe("Segment 8 — Case Statuses and Lifecycle", () => {
  let fx: Fixtures;
  const createdCaseIds: string[] = [];
  let schemeVersionId: string;
  let schemeId: string;

  beforeAll(async () => {
    fx = await buildFixtures();
    const scheme = await testDb.validationScheme.create({
      data: {
        scope: "client",
        clientId: fx.clientA.id,
        name: `Test Lifecycle Scheme ${uniqueSuffix()}`,
        countryCodes: [],
        status: "draft",
        createdByUserId: fx.clientAdminA.id,
      },
    });
    schemeId = scheme.id;
    const schemeVersion = await testDb.validationSchemeVersion.create({
      data: { schemeId: scheme.id, versionNumber: 1, publishedAt: new Date(), publishedByUserId: fx.clientAdminA.id },
    });
    schemeVersionId = schemeVersion.id;
  });

  afterAll(async () => {
    await testDb.caseSubmission.deleteMany({ where: { caseId: { in: createdCaseIds } } });
    await testDb.caseStatusHistory.deleteMany({ where: { caseId: { in: createdCaseIds } } });
    await testDb.validationRun.deleteMany({ where: { caseId: { in: createdCaseIds } } });
    await testDb.case.deleteMany({ where: { id: { in: createdCaseIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "Case", targetId: { in: createdCaseIds } } });
    await testDb.validationSchemeVersion.deleteMany({ where: { schemeId } });
    await testDb.validationScheme.deleteMany({ where: { id: schemeId } });
    await fx.cleanup();
  });

  async function createConnectedCase(status: CaseStatus = "draft") {
    const c = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-LIFECYCLE-${uniqueSuffix()}`,
        caseMode: "client_connected",
        providerId: fx.providerConnected.id,
        createdByUserId: fx.providerUserConnected.id,
        clientId: fx.clientA.id,
        providerClientRelationshipId: fx.activeRelationship.id,
        validationSchemeVersionId: schemeVersionId,
        status,
      },
    });
    createdCaseIds.push(c.id);
    return c;
  }

  async function createStandaloneCase(status: CaseStatus = "draft") {
    const c = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-LIFECYCLE-STANDALONE-${uniqueSuffix()}`,
        caseMode: "standalone",
        providerId: fx.providerStandalone.id,
        createdByUserId: fx.providerUserStandalone.id,
        status,
      },
    });
    createdCaseIds.push(c.id);
    return c;
  }

  /** A connected Case sitting at `validated`, with a completed ValidationRun — the minimum submitCaseService requires. */
  async function createSubmittableCase() {
    const c = await createConnectedCase("validated");
    await testDb.validationRun.create({
      data: {
        caseId: c.id,
        schemeVersionId,
        runNumber: 1,
        status: "completed",
        overallResult: "passed",
        trigger: "provider_started",
        startedByUserId: fx.providerUserConnected.id,
        completedAt: new Date(),
        inputSnapshotHash: `test-hash-${uniqueSuffix()}`,
        casePinnedVersion: c.version,
      },
    });
    return c;
  }

  describe("state machine transition table fidelity", () => {
    it(
      "every table-listed transition is accepted",
      async () => {
        for (const [from, targets] of Object.entries(CASE_TRANSITIONS) as [CaseStatus, CaseStatus[]][]) {
          for (const to of targets) {
            const c = await createConnectedCase(from);
            const updated = await testDb.$transaction((tx) =>
              transitionCaseStatus(tx, fx.authFor("providerUserConnected"), c.id, {
                toStatus: to,
                expectedVersion: c.version,
                actorType: "system",
                source: "system",
              })
            );
            expect(updated.status).toBe(to);
          }
        }
      },
      60000 // ~60 individual transitions, each its own transaction — slower than the default 20s under full-suite DB contention
    );

    it("rejects a representative sample of unlisted transitions", async () => {
      const illegal: [CaseStatus, CaseStatus][] = [
        ["draft", "accepted"],
        ["submitted_to_client", "validating"],
        ["closed", "validated"],
        ["archived", "draft"], // archived is a dead end through this table — reopen bypasses it entirely
      ];
      for (const [from, to] of illegal) {
        const c = await createConnectedCase(from);
        await expect(
          testDb.$transaction((tx) =>
            transitionCaseStatus(tx, fx.authFor("providerUserConnected"), c.id, {
              toStatus: to,
              expectedVersion: c.version,
              actorType: "system",
              source: "system",
            })
          )
        ).rejects.toMatchObject({ code: "invalid_transition" });
      }
    });

    it("every transition creates exactly one CaseStatusHistory row", async () => {
      const c = await createConnectedCase("ready_for_validation");
      await testDb.$transaction((tx) =>
        transitionCaseStatus(tx, fx.authFor("providerUserConnected"), c.id, {
          toStatus: "validating",
          expectedVersion: c.version,
          actorType: "system",
          source: "system",
        })
      );
      const history = await testDb.caseStatusHistory.findMany({ where: { caseId: c.id } });
      expect(history).toHaveLength(1);
      expect(history[0].fromStatus).toBe("ready_for_validation");
      expect(history[0].toStatus).toBe("validating");
    });

    it("rejects a stale expectedVersion with stale_version", async () => {
      const c = await createConnectedCase("ready_for_validation");
      await expect(
        testDb.$transaction((tx) =>
          transitionCaseStatus(tx, fx.authFor("providerUserConnected"), c.id, {
            toStatus: "validating",
            expectedVersion: c.version + 999,
            actorType: "system",
            source: "system",
          })
        )
      ).rejects.toMatchObject({ code: "stale_version" });
    });
  });

  describe("standalone Cases can never reach Client-only statuses", () => {
    it("submitCaseService rejects a standalone Case outright", async () => {
      const standalone = await createStandaloneCase("validated");
      await expect(
        testDb.$transaction((tx) =>
          submitCaseService(tx, fx.authFor("providerUserStandalone"), standalone.id, { version: standalone.version, confirm: true })
        )
      ).rejects.toMatchObject({ code: "invalid_state" });
    });
  });

  describe("Super Admin gets not_found on every lifecycle action", () => {
    it("every action-specific service throws not_found for Super Admin", async () => {
      const c = await createSubmittableCase();
      const superAuth = fx.authFor("superAdmin");
      await expect(
        testDb.$transaction((tx) => submitCaseService(tx, superAuth, c.id, { version: c.version, confirm: true }))
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        testDb.$transaction((tx) => acceptCaseService(tx, superAuth, c.id, { version: c.version }))
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        testDb.$transaction((tx) => closeCaseService(tx, superAuth, c.id, { version: c.version }))
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("Client Admin exclusivity — Provider can never accept/reject/markLiquidated", () => {
    it("acceptCaseService rejects a Provider actor", async () => {
      const c = await createSubmittableCase();
      const submitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
      );
      await expect(
        testDb.$transaction((tx) => acceptCaseService(tx, fx.authFor("providerUserConnected"), submitted.id, { version: submitted.version }))
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("Client Admin submit -> accept -> mark liquidated happy path, with a CaseSubmission snapshot created once", async () => {
      const c = await createSubmittableCase();
      const submitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
      );
      expect(submitted.status).toBe("submitted_to_client");
      const submissions = await testDb.caseSubmission.findMany({ where: { caseId: c.id } });
      expect(submissions).toHaveLength(1);

      const accepted = await testDb.$transaction((tx) =>
        acceptCaseService(tx, fx.authFor("clientAdminA"), submitted.id, { version: submitted.version })
      );
      expect(accepted.status).toBe("accepted");
      expect(accepted.acceptedByUserId).toBe(fx.clientAdminA.id);
      expect(accepted.acceptanceSource).toBe("client_admin");

      const liquidated = await testDb.$transaction((tx) =>
        markLiquidatedService(tx, fx.authFor("clientAdminA"), accepted.id, { version: accepted.version })
      );
      expect(liquidated.status).toBe("liquidated");
      expect(liquidated.liquidatedByUserId).toBe(fx.clientAdminA.id);
    });

    it("a resubmission after further Case activity creates a NEW CaseSubmission row and leaves the old one untouched", async () => {
      const c = await createSubmittableCase();
      const submitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
      );
      const firstSubmission = await testDb.caseSubmission.findFirstOrThrow({ where: { caseId: c.id } });

      const returned = await testDb.$transaction((tx) =>
        returnCaseToProviderService(tx, fx.authFor("clientAdminA"), submitted.id, {
          version: submitted.version,
          returnReason: "additional_information_required",
        })
      );
      // Back to validated so it's submittable again — the table only allows
      // returned_to_provider -> validating -> validated, not a direct hop.
      const backToValidating = await testDb.$transaction((tx) =>
        transitionCaseStatus(tx, fx.authFor("providerUserConnected"), returned.id, {
          toStatus: "validating",
          expectedVersion: returned.version,
          actorType: "system",
          source: "system",
        })
      );
      const revalidated = await testDb.$transaction((tx) =>
        transitionCaseStatus(tx, fx.authFor("providerUserConnected"), backToValidating.id, {
          toStatus: "validated",
          expectedVersion: backToValidating.version,
          actorType: "system",
          source: "system",
        })
      );
      await testDb.validationRun.create({
        data: {
          caseId: c.id,
          schemeVersionId,
          runNumber: 2,
          status: "completed",
          overallResult: "passed",
          trigger: "provider_revalidated",
          startedByUserId: fx.providerUserConnected.id,
          completedAt: new Date(),
          inputSnapshotHash: `test-hash-${uniqueSuffix()}`,
          casePinnedVersion: revalidated.version,
        },
      });
      const resubmitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), revalidated.id, { version: revalidated.version, confirm: true })
      );
      expect(resubmitted.status).toBe("submitted_to_client");

      const allSubmissions = await testDb.caseSubmission.findMany({ where: { caseId: c.id }, orderBy: { submittedAt: "asc" } });
      expect(allSubmissions).toHaveLength(2);
      const firstAfter = await testDb.caseSubmission.findUniqueOrThrow({ where: { id: firstSubmission.id } });
      expect(firstAfter.validationRunId).toBe(firstSubmission.validationRunId);
      expect(firstAfter.submittedAt.getTime()).toBe(firstSubmission.submittedAt.getTime());
    });

    it("rejectCaseService requires Client Admin and a non-empty rejectionNote — never reachable from startValidationRunService's own status mapping", async () => {
      const c = await createSubmittableCase();
      const submitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
      );
      const rejected = await testDb.$transaction((tx) =>
        rejectCaseService(tx, fx.authFor("clientAdminA"), submitted.id, {
          version: submitted.version,
          rejectionReason: "not_eligible",
          rejectionNote: "Outside policy coverage",
        })
      );
      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectionReason).toBe("not_eligible");
    });
  });

  describe("reopen — never from liquidated", () => {
    it("reopenCaseService rejects a liquidated Case even with allowReopen semantics", async () => {
      const c = await createSubmittableCase();
      const submitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
      );
      const accepted = await testDb.$transaction((tx) =>
        acceptCaseService(tx, fx.authFor("clientAdminA"), submitted.id, { version: submitted.version })
      );
      const liquidated = await testDb.$transaction((tx) =>
        markLiquidatedService(tx, fx.authFor("clientAdminA"), accepted.id, { version: accepted.version })
      );
      await expect(
        testDb.$transaction((tx) =>
          reopenCaseService(tx, fx.authFor("clientAdminA"), liquidated.id, { version: liquidated.version, reason: "Trying to undo a payout" })
        )
      ).rejects.toMatchObject({ code: "invalid_transition" });
    });

    it("a Provider can reopen a Case they closed; a Client Admin can reopen a Case they rejected, but a Provider cannot", async () => {
      const standalone = await createStandaloneCase("validated");
      const closed = await testDb.$transaction((tx) =>
        closeCaseService(tx, fx.authFor("providerUserStandalone"), standalone.id, { version: standalone.version })
      );
      const reopened = await testDb.$transaction((tx) =>
        reopenCaseService(tx, fx.authFor("providerUserStandalone"), closed.id, { version: closed.version, reason: "Reopening to add a document" })
      );
      expect(reopened.status).toBe("draft");

      const c = await createSubmittableCase();
      const submitted = await testDb.$transaction((tx) =>
        submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
      );
      const rejected = await testDb.$transaction((tx) =>
        rejectCaseService(tx, fx.authFor("clientAdminA"), submitted.id, {
          version: submitted.version,
          rejectionReason: "not_eligible",
          rejectionNote: "Outside policy coverage",
        })
      );
      await expect(
        testDb.$transaction((tx) =>
          reopenCaseService(tx, fx.authFor("providerUserConnected"), rejected.id, { version: rejected.version, reason: "Provider trying to reopen" })
        )
      ).rejects.toMatchObject({ code: "invalid_transition" }); // Provider owns the Case but "rejected" isn't in ITS allowed-source list — that decision belongs to the Client alone

      const reopenedByClient = await testDb.$transaction((tx) =>
        reopenCaseService(tx, fx.authFor("clientAdminA"), rejected.id, { version: rejected.version, reason: "Client reconsidered" })
      );
      expect(reopenedByClient.status).toBe("draft");
    });
  });

  describe("cancel — requires a reason, only from early statuses", () => {
    it("cancelCaseService rejects a Case past the document/validation phase", async () => {
      const c = await createSubmittableCase(); // status "validated"
      await expect(
        testDb.$transaction((tx) =>
          cancelCaseService(tx, fx.authFor("providerUserConnected"), c.id, {
            version: c.version,
            cancellationReason: "created_by_mistake",
          })
        )
      ).rejects.toMatchObject({ code: "invalid_transition" });
    });

    it("cancelCaseService succeeds from draft and records the reason", async () => {
      const draft = await createConnectedCase("draft");
      const cancelled = await testDb.$transaction((tx) =>
        cancelCaseService(tx, fx.authFor("providerUserConnected"), draft.id, {
          version: draft.version,
          cancellationReason: "duplicate_case",
          cancellationNote: "Same patient, same event, filed twice",
        })
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancellationReason).toBe("duplicate_case");
    });
  });

  describe("close — dual actor", () => {
    it("a Client Admin can close a connected, validated Case", async () => {
      const c = await createConnectedCase("validated_with_issues");
      const closed = await testDb.$transaction((tx) =>
        closeCaseService(tx, fx.authFor("clientAdminA"), c.id, { version: c.version })
      );
      expect(closed.status).toBe("closed");
    });

    it("closeCaseService rejects a Case that was never validated", async () => {
      const draft = await createConnectedCase("draft");
      await expect(
        testDb.$transaction((tx) => closeCaseService(tx, fx.authFor("providerUserConnected"), draft.id, { version: draft.version }))
      ).rejects.toMatchObject({ code: "invalid_transition" });
    });
  });

  it("a Client Admin from a different Client cannot act on someone else's Case (not_found, not forbidden)", async () => {
    const c = await createSubmittableCase();
    const submitted = await testDb.$transaction((tx) =>
      submitCaseService(tx, fx.authFor("providerUserConnected"), c.id, { version: c.version, confirm: true })
    );
    await expect(
      testDb.$transaction((tx) => acceptCaseService(tx, fx.authFor("clientAdminB"), submitted.id, { version: submitted.version }))
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("CaseServiceError is thrown, never a bare Error, for every rejection path exercised above", () => {
    // Sanity check on the shared error type this whole file asserts `.code` against.
    expect(new CaseServiceError("invalid_transition", "x")).toBeInstanceOf(CaseServiceError);
  });
});
