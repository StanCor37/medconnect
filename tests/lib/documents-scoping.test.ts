import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../setup/documentFixtures";
import { scopedDocumentWhere } from "@/lib/documents/scoping";

describe("scopedDocumentWhere", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const documentIds: Record<string, string> = {};

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);

    // One Document per Case, minimal — visibility is entirely determined by
    // the parent Case, so these don't need a real SourceFile/Version.
    const standaloneDoc = await testDb.document.create({
      data: { caseId: dfx.standaloneCase.id, createdByUserId: fx.providerUserStandalone.id },
    });
    documentIds.standalone = standaloneDoc.id;

    const connectedDoc = await testDb.document.create({
      data: { caseId: dfx.connectedCase.id, createdByUserId: fx.providerUserConnected.id },
    });
    documentIds.connected = connectedDoc.id;

    const creatorOnlyDoc = await testDb.document.create({
      data: { caseId: dfx.creatorOnlyCase.id, createdByUserId: fx.providerUserConnected.id },
    });
    documentIds.creatorOnly = creatorOnlyDoc.id;

    const pendingDoc = await testDb.document.create({
      data: { caseId: dfx.pendingRelationshipCase.id, createdByUserId: fx.providerUserConnected.id },
    });
    documentIds.pending = pendingDoc.id;
  });

  afterAll(async () => {
    await testDb.document.deleteMany({ where: { id: { in: Object.values(documentIds) } } });
    await dfx.cleanup();
    await fx.cleanup();
  });

  async function visibleDocumentIds(auth: ReturnType<Fixtures["authFor"]>) {
    const rows = await testDb.document.findMany({
      where: { AND: [{ id: { in: Object.values(documentIds) } }, scopedDocumentWhere(auth)] },
      select: { id: true },
    });
    return rows.map((r) => r.id).sort();
  }

  it("Super Admin sees ZERO documents, even for a Client-shared Case", async () => {
    const ids = await visibleDocumentIds(fx.authFor("superAdmin"));
    expect(ids).toEqual([]);
  });

  it("the owning Provider User sees the provider_shared Case's document and their own creator_only document", async () => {
    const ids = await visibleDocumentIds(fx.authFor("providerUserConnected"));
    expect(ids).toContain(documentIds.connected);
    expect(ids).toContain(documentIds.creatorOnly);
    expect(ids).not.toContain(documentIds.standalone); // different Provider entirely
  });

  it("a colleague on the same Provider cannot see a creator_only document", async () => {
    const ids = await visibleDocumentIds(fx.authFor("providerUserConnectedColleague"));
    expect(ids).toContain(documentIds.connected);
    expect(ids).not.toContain(documentIds.creatorOnly);
  });

  it("the standalone Provider User sees only their own standalone Case's document", async () => {
    const ids = await visibleDocumentIds(fx.authFor("providerUserStandalone"));
    expect(ids).toEqual([documentIds.standalone]);
  });

  it("Client Admin A sees only the actively-shared Case's document", async () => {
    const ids = await visibleDocumentIds(fx.authFor("clientAdminA"));
    expect(ids).toEqual([documentIds.connected]);
  });

  it("Client Admin B sees nothing — a PENDING relationship grants zero visibility, same as no relationship at all", async () => {
    const ids = await visibleDocumentIds(fx.authFor("clientAdminB"));
    expect(ids).toEqual([]);
    expect(ids).not.toContain(documentIds.pending);
  });

  it("a standalone Case's document is invisible to any Client Admin", async () => {
    const idsA = await visibleDocumentIds(fx.authFor("clientAdminA"));
    const idsB = await visibleDocumentIds(fx.authFor("clientAdminB"));
    expect(idsA).not.toContain(documentIds.standalone);
    expect(idsB).not.toContain(documentIds.standalone);
  });
});
