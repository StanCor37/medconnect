import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../setup/documentFixtures";
import {
  resolveAvailableDocumentTypesForCase,
  isValidDocumentTypeCodeForCase,
  GENERAL_DOCUMENT_TYPES,
  OTHER_DOCUMENT_TYPE,
} from "@/lib/documents/documentTypes";
import { testDb } from "../setup/testDb";

describe("Document Types resolution", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);
  });

  afterAll(async () => {
    await dfx.cleanup();
    await fx.cleanup();
  });

  it("a Scheme-pinned Case only accepts its own Scheme version's codes plus other_document", async () => {
    const types = await testDb.$transaction((tx) => resolveAvailableDocumentTypesForCase(tx, dfx.connectedCase));
    const codes = types.map((t) => t.code).sort();
    expect(codes).toEqual(["invoice", "lab_result", "medical_report", "other_document"].sort());
  });

  it("a Scheme-only code is valid for the Scheme-pinned Case but not for a no-Scheme Case, and vice versa for a general-only code", async () => {
    const labResultOnScheme = await testDb.$transaction((tx) =>
      isValidDocumentTypeCodeForCase(tx, dfx.connectedCase, "lab_result")
    );
    const labResultOnGeneral = await testDb.$transaction((tx) =>
      isValidDocumentTypeCodeForCase(tx, dfx.standaloneCase, "lab_result")
    );
    expect(labResultOnScheme).toBe(true);
    expect(labResultOnGeneral).toBe(false);

    const passportOnGeneral = await testDb.$transaction((tx) =>
      isValidDocumentTypeCodeForCase(tx, dfx.standaloneCase, "passport")
    );
    const passportOnScheme = await testDb.$transaction((tx) => isValidDocumentTypeCodeForCase(tx, dfx.connectedCase, "passport"));
    expect(passportOnGeneral).toBe(true);
    expect(passportOnScheme).toBe(false);
  });

  it("a no-Scheme Case accepts only the general fallback list plus other_document", async () => {
    const types = await testDb.$transaction((tx) => resolveAvailableDocumentTypesForCase(tx, dfx.standaloneCase));
    const codes = types.map((t) => t.code).sort();
    expect(codes).toEqual([...GENERAL_DOCUMENT_TYPES.map((t) => t.code), OTHER_DOCUMENT_TYPE.code].sort());
  });

  it("other_document is available even though it was never explicitly seeded as a row", async () => {
    const schemeTypes = await testDb.documentTypeDefinition.findMany({ where: { schemeVersionId: dfx.schemeVersion.id } });
    expect(schemeTypes.some((t) => t.code === "other_document")).toBe(false);

    const valid = await testDb.$transaction((tx) => isValidDocumentTypeCodeForCase(tx, dfx.connectedCase, "other_document"));
    expect(valid).toBe(true);
  });

  it("an invalid code is rejected for both a Scheme-pinned and a no-Scheme Case", async () => {
    const validForConnected = await testDb.$transaction((tx) =>
      isValidDocumentTypeCodeForCase(tx, dfx.connectedCase, "not_a_real_type")
    );
    const validForStandalone = await testDb.$transaction((tx) =>
      isValidDocumentTypeCodeForCase(tx, dfx.standaloneCase, "not_a_real_type")
    );
    expect(validForConnected).toBe(false);
    expect(validForStandalone).toBe(false);
  });
});
