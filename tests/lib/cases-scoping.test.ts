import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { scopedCaseWhere } from "@/lib/cases/scoping";

describe("scopedCaseWhere — the real authorization boundary for Cases today", () => {
  let fx: Fixtures;
  let standaloneCaseId: string;
  let connectedCaseSharedWithAId: string;
  let creatorOnlyCaseId: string;
  let insurerRecognizedCaseId: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    const standalone = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-${uniqueSuffix()}`,
        caseMode: "standalone",
        providerId: fx.providerStandalone.id,
        createdByUserId: fx.providerUserStandalone.id,
      },
    });
    standaloneCaseId = standalone.id;

    const connected = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-${uniqueSuffix()}`,
        caseMode: "client_connected",
        providerId: fx.providerConnected.id,
        createdByUserId: fx.providerUserConnected.id,
        clientId: fx.clientA.id,
        providerClientRelationshipId: fx.activeRelationship.id,
      },
    });
    connectedCaseSharedWithAId = connected.id;

    const creatorOnly = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-${uniqueSuffix()}`,
        caseMode: "standalone",
        providerId: fx.providerConnected.id,
        createdByUserId: fx.providerUserConnected.id,
        providerCaseAccess: "creator_only",
      },
    });
    creatorOnlyCaseId = creatorOnly.id;

    const insurerRecognized = await testDb.case.create({
      data: {
        internalReference: `MC-TEST-${uniqueSuffix()}`,
        caseMode: "standalone",
        providerId: fx.providerStandalone.id,
        createdByUserId: fx.providerUserStandalone.id,
        insurerId: fx.insurer.id,
      },
    });
    insurerRecognizedCaseId = insurerRecognized.id;
  });

  afterAll(async () => {
    await testDb.case.deleteMany({
      where: { id: { in: [standaloneCaseId, connectedCaseSharedWithAId, creatorOnlyCaseId, insurerRecognizedCaseId] } },
    });
    await fx.cleanup();
  });

  // AND (not a spread) — scopedCaseWhere's super_admin branch returns its
  // own `id` field (the NEVER_MATCH sentinel), which a naive `{ id: {in},
  // ...scopedCaseWhere(auth) }` spread would silently clobber, exactly the
  // bug class already found twice in this codebase for Provider/Client.
  async function visibleIds(auth: ReturnType<Fixtures["authFor"]>, candidateIds: string[]) {
    const rows = await testDb.case.findMany({
      where: { AND: [{ id: { in: candidateIds } }, scopedCaseWhere(auth)] },
      select: { id: true },
    });
    return rows.map((r) => r.id).sort();
  }

  it("Provider User (standalone) sees only their own Provider's Cases", async () => {
    const ids = await visibleIds(fx.authFor("providerUserStandalone"), [
      standaloneCaseId,
      connectedCaseSharedWithAId,
      creatorOnlyCaseId,
    ]);
    expect(ids).toEqual([standaloneCaseId].sort());
  });

  it("a creator_only Case is invisible to a colleague on the same Provider", async () => {
    const ids = await visibleIds(fx.authFor("providerUserConnectedColleague"), [
      connectedCaseSharedWithAId,
      creatorOnlyCaseId,
    ]);
    expect(ids).toEqual([connectedCaseSharedWithAId]);
  });

  it("a creator_only Case IS visible to its creator", async () => {
    const ids = await visibleIds(fx.authFor("providerUserConnected"), [connectedCaseSharedWithAId, creatorOnlyCaseId]);
    expect(ids.sort()).toEqual([connectedCaseSharedWithAId, creatorOnlyCaseId].sort());
  });

  it("Client Admin A sees the Case shared with it via an ACTIVE relationship", async () => {
    const ids = await visibleIds(fx.authFor("clientAdminA"), [
      standaloneCaseId,
      connectedCaseSharedWithAId,
      creatorOnlyCaseId,
    ]);
    expect(ids).toEqual([connectedCaseSharedWithAId]);
  });

  it("Client Admin B sees NOTHING for the same Provider — only a pending relationship exists", async () => {
    const ids = await visibleIds(fx.authFor("clientAdminB"), [connectedCaseSharedWithAId, creatorOnlyCaseId]);
    expect(ids).toEqual([]);
  });

  it("a standalone Case is invisible to every Client, even Client A which the Provider will later connect to", async () => {
    const ids = await visibleIds(fx.authFor("clientAdminA"), [standaloneCaseId]);
    expect(ids).toEqual([]);
  });

  it("Super Admin sees ZERO Cases — the one resource type with no standalone-only carve-out", async () => {
    const ids = await visibleIds(fx.authFor("superAdmin"), [
      standaloneCaseId,
      connectedCaseSharedWithAId,
      creatorOnlyCaseId,
      insurerRecognizedCaseId,
    ]);
    expect(ids).toEqual([]);
  });

  it("a recognized insurer never grants access to any Client, regardless of match", async () => {
    const idsA = await visibleIds(fx.authFor("clientAdminA"), [insurerRecognizedCaseId]);
    const idsB = await visibleIds(fx.authFor("clientAdminB"), [insurerRecognizedCaseId]);
    expect(idsA).toEqual([]);
    expect(idsB).toEqual([]);
  });
});
