import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import {
  createCaseService,
  updateCaseService,
  shareWithClientService,
  assignCaseService,
  archiveCaseService,
  deleteCaseService,
} from "@/lib/cases/service";
import { hashRequestBody } from "@/lib/cases/idempotency";

describe("cases/service — create, duplicate detection, idempotency", () => {
  let fx: Fixtures;
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await testDb.idempotencyKey.deleteMany({ where: { caseId: { in: createdCaseIds } } });
    await testDb.case.deleteMany({ where: { id: { in: createdCaseIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "Case", targetId: { in: createdCaseIds } } });
    await fx.cleanup();
  });

  it("creates a standalone Case with a well-formed, unique internal reference", async () => {
    const result = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), {
        serviceType: "outpatient",
        patientReference: "PT-1",
      })
    );
    createdCaseIds.push(result.case.id);
    expect(result.case.internalReference).toMatch(/^MC-\d{4}-\d{7}$/);
    expect(result.case.caseMode).toBe("standalone");
    expect(result.case.status).toBe("draft");
  });

  it("creates N Cases concurrently with N distinct internal references (no race in the counter)", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        testDb.$transaction((tx) =>
          createCaseService(tx, fx.authFor("providerUserStandalone"), {
            serviceType: "outpatient",
            patientReference: `PT-CONCURRENT-${i}`,
          })
        )
      )
    );
    results.forEach((r) => createdCaseIds.push(r.case.id));
    const refs = results.map((r) => r.case.internalReference);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("rejects client-connected creation against an inactive (pending) relationship", async () => {
    await expect(
      testDb.$transaction((tx) =>
        createCaseService(tx, fx.authFor("providerUserConnected"), {
          clientId: fx.clientB.id, // only a pending relationship exists to Client B
          serviceType: "outpatient",
        })
      )
    ).rejects.toMatchObject({ code: "inactive_relationship" });
  });

  it("creates a client-connected Case against an active relationship", async () => {
    const result = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserConnected"), {
        clientId: fx.clientA.id,
        serviceType: "outpatient",
      })
    );
    createdCaseIds.push(result.case.id);
    expect(result.case.caseMode).toBe("client_connected");
    expect(result.case.clientId).toBe(fx.clientA.id);
    expect(result.case.providerClientRelationshipId).toBe(fx.activeRelationship.id);
  });

  it("blocks an exact-match external reference (409-mapped, standalone-vs-standalone — the case the DB constraint's NULL-distinctness can't catch)", async () => {
    const first = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), {
        externalReference: "EXT-DUP-1",
        externalReferenceSource: "provider",
      })
    );
    createdCaseIds.push(first.case.id);

    await expect(
      testDb.$transaction((tx) =>
        createCaseService(tx, fx.authFor("providerUserStandalone"), {
          externalReference: "EXT-DUP-1",
          externalReferenceSource: "provider",
        })
      )
    ).rejects.toMatchObject({ code: "duplicate_external_reference" });
  });

  it("warns on a probable match, then succeeds once confirmedNotDuplicateBy is supplied", async () => {
    const first = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), {
        patientReference: "PT-PROBABLE",
        eventDate: new Date("2026-01-01"),
        serviceType: "outpatient",
      })
    );
    createdCaseIds.push(first.case.id);

    await expect(
      testDb.$transaction((tx) =>
        createCaseService(tx, fx.authFor("providerUserStandalone"), {
          patientReference: "PT-PROBABLE",
          eventDate: new Date("2026-01-01"),
          serviceType: "outpatient",
        })
      )
    ).rejects.toMatchObject({ code: "probable_duplicate_case" });

    const second = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), {
        patientReference: "PT-PROBABLE",
        eventDate: new Date("2026-01-01"),
        serviceType: "outpatient",
        confirmedNotDuplicateBy: fx.providerUserStandalone.id,
      })
    );
    createdCaseIds.push(second.case.id);

    const overrideEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "Case", targetId: second.case.id, eventType: "case_duplicate_warning_overridden" },
    });
    expect(overrideEvent).not.toBeNull();
  });

  it("idempotency: same key + same body replays the original Case, no duplicate row", async () => {
    const input = { serviceType: "outpatient", patientReference: "PT-IDEMPOTENT" };
    const key = "test-idem-key-1";
    const requestHash = hashRequestBody(input);

    const first = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), input, { key, requestHash })
    );
    createdCaseIds.push(first.case.id);
    expect(first.replayed).toBe(false);

    const replay = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), input, { key, requestHash })
    );
    expect(replay.replayed).toBe(true);
    expect(replay.case.id).toBe(first.case.id);

    const count = await testDb.case.count({ where: { patientReference: "PT-IDEMPOTENT" } });
    expect(count).toBe(1);
  });

  it("idempotency: same key + different body is rejected as a conflict", async () => {
    const key = "test-idem-key-2";
    const first = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), { patientReference: "PT-A" }, { key, requestHash: hashRequestBody({ patientReference: "PT-A" }) })
    );
    createdCaseIds.push(first.case.id);

    await expect(
      testDb.$transaction((tx) =>
        createCaseService(
          tx,
          fx.authFor("providerUserStandalone"),
          { patientReference: "PT-B" },
          { key, requestHash: hashRequestBody({ patientReference: "PT-B" }) }
        )
      )
    ).rejects.toMatchObject({ code: "idempotency_key_conflict" });
  });
});

describe("cases/service — update, share, assign, archive lifecycle", () => {
  let fx: Fixtures;
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await testDb.caseStatusHistory.deleteMany({ where: { caseId: { in: createdCaseIds } } });
    await testDb.case.deleteMany({ where: { id: { in: createdCaseIds } } });
    await testDb.auditEvent.deleteMany({ where: { targetType: "Case", targetId: { in: createdCaseIds } } });
    await fx.cleanup();
  });

  async function createDraft() {
    const result = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserStandalone"), { serviceType: "outpatient" })
    );
    createdCaseIds.push(result.case.id);
    return result.case;
  }

  it("updateCaseService returns the POST-mutation object and records changed field names only (never values)", async () => {
    const draft = await createDraft();
    const updated = await testDb.$transaction((tx) =>
      updateCaseService(tx, fx.authFor("providerUserStandalone"), draft.id, {
        version: draft.version,
        serviceType: "inpatient",
      })
    );
    expect(updated.serviceType).toBe("inpatient");
    expect(updated.version).toBe(draft.version + 1);

    const event = await testDb.auditEvent.findFirstOrThrow({
      where: { targetType: "Case", targetId: draft.id, eventType: "case_updated" },
    });
    expect(event.reasonCode).toBe("fields:serviceType");
  });

  it("rejects a stale version on update instead of silently overwriting", async () => {
    const draft = await createDraft();
    await expect(
      testDb.$transaction((tx) =>
        updateCaseService(tx, fx.authFor("providerUserStandalone"), draft.id, {
          version: draft.version + 999, // deliberately stale/wrong
          serviceType: "inpatient",
        })
      )
    ).rejects.toMatchObject({ code: "stale_version" });
  });

  it("shareWithClientService sets clientId/relationship/mode and returns the POST-mutation object", async () => {
    const created = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserConnected"), { serviceType: "outpatient" })
    );
    createdCaseIds.push(created.case.id);

    const shared = await testDb.$transaction((tx) =>
      shareWithClientService(
        tx,
        fx.authFor("providerUserConnected"),
        created.case.id,
        fx.clientA.id,
        created.case.version
      )
    );
    expect(shared.caseMode).toBe("client_connected");
    expect(shared.clientId).toBe(fx.clientA.id);
    expect(shared.providerClientRelationshipId).toBe(fx.activeRelationship.id);
  });

  it("shareWithClientService rejects sharing with a Client the Provider has no relationship with at all", async () => {
    const draft = await createDraft(); // providerStandalone has zero relationships to any Client
    await expect(
      testDb.$transaction((tx) =>
        shareWithClientService(tx, fx.authFor("providerUserStandalone"), draft.id, fx.clientA.id, draft.version)
      )
    ).rejects.toMatchObject({ code: "inactive_relationship" });
  });

  it("assignCaseService rejects a target User from a different Provider (never moves a Case cross-Provider)", async () => {
    const draft = await createDraft();
    await expect(
      testDb.$transaction((tx) =>
        assignCaseService(tx, fx.authFor("providerUserStandalone"), draft.id, fx.providerUserConnected.id, draft.version)
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("assignCaseService assigns within the same Provider and preserves createdByUserId", async () => {
    // Reuse the connected Provider, which has a real colleague fixture.
    const created = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserConnected"), { serviceType: "outpatient" })
    );
    createdCaseIds.push(created.case.id);

    const assigned = await testDb.$transaction((tx) =>
      assignCaseService(
        tx,
        fx.authFor("providerUserConnected"),
        created.case.id,
        fx.providerUserConnectedColleague.id,
        created.case.version
      )
    );
    expect(assigned.assignedToUserId).toBe(fx.providerUserConnectedColleague.id);
    expect(assigned.createdByUserId).toBe(fx.providerUserConnected.id);
  });

  it("a colleague cannot mutate a creator_only Case (not_found, not forbidden)", async () => {
    const creatorOnly = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-CO-${uniqueSuffix()}`,
        caseMode: "standalone",
        providerId: fx.providerConnected.id,
        createdByUserId: fx.providerUserConnected.id,
        providerCaseAccess: "creator_only",
      },
    });
    createdCaseIds.push(creatorOnly.id);

    await expect(
      testDb.$transaction((tx) =>
        updateCaseService(tx, fx.authFor("providerUserConnectedColleague"), creatorOnly.id, {
          version: creatorOnly.version,
          serviceType: "inpatient",
        })
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("archiveCaseService archives a draft; deleteCaseService hard-deletes a zero-activity standalone draft", async () => {
    const draft = await createDraft();
    const archived = await testDb.$transaction((tx) =>
      archiveCaseService(tx, fx.authFor("providerUserStandalone"), draft.id, draft.version)
    );
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();

    const fresh = await createDraft();
    const result = await testDb.$transaction((tx) =>
      deleteCaseService(tx, fx.authFor("providerUserStandalone"), fresh.id)
    );
    expect(result.hardDeleted).toBe(true);
    const gone = await testDb.case.findUnique({ where: { id: fresh.id } });
    expect(gone).toBeNull();
  });

  it("deleteCaseService falls back to archive for a Case with sharing activity beyond creation", async () => {
    const created = await testDb.$transaction((tx) =>
      createCaseService(tx, fx.authFor("providerUserConnected"), { serviceType: "outpatient" })
    );
    createdCaseIds.push(created.case.id);

    await testDb.$transaction((tx) =>
      shareWithClientService(
        tx,
        fx.authFor("providerUserConnected"),
        created.case.id,
        fx.clientA.id,
        created.case.version
      )
    );
    const result = await testDb.$transaction((tx) =>
      deleteCaseService(tx, fx.authFor("providerUserConnected"), created.case.id)
    );
    expect(result.hardDeleted).toBe(false);
    const stillExists = await testDb.case.findUnique({ where: { id: created.case.id } });
    expect(stillExists?.status).toBe("archived");
  });
});
