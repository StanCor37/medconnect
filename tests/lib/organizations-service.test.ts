import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import {
  createRelationshipService,
  activateRelationshipService,
  changeRelationshipStatusService,
  AccountServiceError,
} from "@/lib/organizations/service";
import { checkForDuplicateProvider } from "@/lib/duplicate-detection/provider";

describe("organizations service — relationship lifecycle", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    // clean up anything this file creates beyond the shared fixture set
    await testDb.providerClientRelationship.deleteMany({
      where: { providerId: fx.providerStandalone.id, clientId: fx.clientB.id },
    });
    await fx.cleanup();
  });

  it("Client Admin B can request a connection to the standalone Provider (pending)", async () => {
    const relationship = await testDb.$transaction((tx) =>
      createRelationshipService(tx, fx.authFor("clientAdminB"), fx.providerStandalone.id)
    );
    expect(relationship.status).toBe("pending");
  });

  it("requesting the same connection twice is rejected, not silently duplicated", async () => {
    await expect(
      testDb.$transaction((tx) =>
        createRelationshipService(tx, fx.authFor("clientAdminB"), fx.providerStandalone.id)
      )
    ).rejects.toBeInstanceOf(AccountServiceError);
  });

  it("activating returns the UPDATED row (regression test for the stale-return bug found during manual testing)", async () => {
    const pending = await testDb.providerClientRelationship.findFirstOrThrow({
      where: { providerId: fx.providerStandalone.id, clientId: fx.clientB.id },
    });

    const activated = await testDb.$transaction((tx) =>
      activateRelationshipService(tx, fx.authFor("providerUserStandalone"), pending.id)
    );

    expect(activated.status).toBe("active");
    expect(activated.activatedAt).not.toBeNull();

    const provider = await testDb.provider.findUniqueOrThrow({ where: { id: fx.providerStandalone.id } });
    expect(provider.mode).toBe("client_connected");
  });

  it("suspend/terminate also return the UPDATED row, and only affect the targeted relationship", async () => {
    const relationship = await testDb.providerClientRelationship.findFirstOrThrow({
      where: { providerId: fx.providerStandalone.id, clientId: fx.clientB.id },
    });

    const suspended = await testDb.$transaction((tx) =>
      changeRelationshipStatusService(tx, fx.authFor("clientAdminB"), relationship.id, "suspend")
    );
    expect(suspended.status).toBe("suspended");
    expect(suspended.suspendedAt).not.toBeNull();

    // The pre-existing active relationship (Client A <-> connected Provider)
    // must be completely unaffected (Segment 2 §3 isolation).
    const unrelated = await testDb.providerClientRelationship.findUniqueOrThrow({
      where: { id: fx.activeRelationship.id },
    });
    expect(unrelated.status).toBe("active");

    // With its only relationship now suspended, the standalone Provider
    // reverts to standalone mode (no active relationships remain).
    const provider = await testDb.provider.findUniqueOrThrow({ where: { id: fx.providerStandalone.id } });
    expect(provider.mode).toBe("standalone");
  });

  it("a Client Admin cannot activate a relationship belonging to a different Client", async () => {
    await testDb.providerClientRelationship.update({
      where: { providerId_clientId: { providerId: fx.providerStandalone.id, clientId: fx.clientB.id } },
      data: { status: "pending" },
    });
    const relationship = await testDb.providerClientRelationship.findFirstOrThrow({
      where: { providerId: fx.providerStandalone.id, clientId: fx.clientB.id },
    });

    await expect(
      testDb.$transaction((tx) =>
        activateRelationshipService(tx, fx.authFor("clientAdminA"), relationship.id)
      )
    ).rejects.toThrow(/Not your Client/);
  });
});

describe("duplicate-provider detection", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("blocks an exact registration-number match in the same country", async () => {
    const result = await testDb.$transaction((tx) =>
      checkForDuplicateProvider(tx, {
        country: fx.providerStandalone.country,
        officialRegistrationNumber: fx.providerStandalone.officialRegistrationNumber!,
        legalName: "A completely different name",
      })
    );
    expect(result.kind).toBe("exact_match");
  });

  it("does not block a different registration number in the same country", async () => {
    const result = await testDb.$transaction((tx) =>
      checkForDuplicateProvider(tx, {
        country: fx.providerStandalone.country,
        officialRegistrationNumber: "COMPLETELY-DIFFERENT-NUMBER",
        legalName: "Some Other Clinic",
      })
    );
    expect(result.kind).not.toBe("exact_match");
  });

  it("warns (probable_match) on a similar name with no official-identifier conflict", async () => {
    const result = await testDb.$transaction((tx) =>
      checkForDuplicateProvider(tx, {
        country: fx.providerStandalone.country,
        legalName: fx.providerStandalone.legalName, // exact name, no registration number supplied
      })
    );
    expect(result.kind).toBe("probable_match");
  });
});
