import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../setup/documentFixtures";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { FakeOcrClient } from "../setup/fakeOcrClient";
import { MAX_FILE_SIZE_BYTES } from "@/lib/documents/limits";
import {
  uploadDocumentsService,
  confirmDocumentTypeService,
  replaceDocumentVersionService,
  archiveDocumentService,
  deleteDocumentService,
  DocumentServiceError,
  type UploadFileInput,
} from "@/lib/documents/service";

function buildPdf(opts: { pages?: number; encrypted?: boolean; header?: boolean; trailer?: boolean } = {}): Buffer {
  const { pages = 1, encrypted = false, header = true, trailer = true } = opts;
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ");
  const pageObjs = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join("\n");
  let body = header ? "%PDF-1.4\n" : "";
  body += `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n`;
  body += `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj\n`;
  body += `${pageObjs}\n`;
  body += `% unique:${uniqueSuffix()}\n`;
  if (encrypted) body += "trailer << /Root 1 0 R /Encrypt 99 0 R >>\n";
  if (trailer) body += "%%EOF";
  return Buffer.from(body, "latin1");
}

function buildJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`unique:${uniqueSuffix()}-padding-to-be-a-plausible-file`, "latin1"),
  ]);
}

function file(name: string, buffer: Buffer): UploadFileInput {
  return { originalFilename: name, buffer };
}

describe("documents/service", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const scanner = new NoOpMalwareScanner();
  const ocr = new FakeOcrClient();

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);
  });

  afterAll(async () => {
    await dfx.cleanup();
    await fx.cleanup();
  });

  it("only a provider_user can upload — Client Admin and Super Admin are rejected", async () => {
    await expect(
      testDb.$transaction((tx) =>
        uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("clientAdminA"), dfx.standaloneCase.id, [file("a.pdf", buildPdf())], undefined)
      )
    ).rejects.toBeInstanceOf(DocumentServiceError);
    await expect(
      testDb.$transaction((tx) =>
        uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("superAdmin"), dfx.standaloneCase.id, [file("a.pdf", buildPdf())], undefined)
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("a Provider User at a different Provider is rejected, as is a colleague on a creator_only Case", async () => {
    await expect(
      testDb.$transaction((tx) =>
        uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.connectedCase.id, [file("a.pdf", buildPdf())], undefined)
      )
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      testDb.$transaction((tx) =>
        uploadDocumentsService(
          tx,
          dfx.storage,
          scanner,
          ocr,
          fx.authFor("providerUserConnectedColleague"),
          dfx.creatorOnlyCase.id,
          [file("a.pdf", buildPdf())],
          undefined
        )
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("magic-byte validation wins over a lying declared filename/extension", async () => {
    const garbage = Buffer.from("this is not any of the 6 supported formats, just text", "latin1");
    const results = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("totally-a-real.pdf", garbage)], undefined)
    );
    expect(results).toEqual([{ filename: "totally-a-real.pdf", status: "rejected", errorCode: "unsupported_format" }]);
  });

  it("rejects a file exceeding the maximum size", async () => {
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(MAX_FILE_SIZE_BYTES)]);
    const results = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("huge.jpg", oversized)], undefined)
    );
    expect(results).toEqual([{ filename: "huge.jpg", status: "rejected", errorCode: "file_too_large" }]);
  });

  it("rejects password-protected and corrupted PDFs pre-storage, without persisting anything", async () => {
    const encrypted = buildPdf({ encrypted: true });
    // Missing header would fail MIME sniffing itself (unsupported_format,
    // not corrupted_file) — a realistic "corrupted mid-file" case keeps a
    // valid %PDF- header (so it sniffs as a PDF) but is missing the %%EOF
    // trailer, which checkPdfReadability catches as corruption.
    const corrupted = buildPdf({ trailer: false });
    const results = await testDb.$transaction((tx) =>
      uploadDocumentsService(
        tx,
        dfx.storage,
        scanner,
        ocr,
        fx.authFor("providerUserStandalone"),
        dfx.standaloneCase.id,
        [file("locked.pdf", encrypted), file("broken.pdf", corrupted)],
        undefined
      )
    );
    expect(results).toEqual([
      { filename: "locked.pdf", status: "rejected", errorCode: "password_protected" },
      { filename: "broken.pdf", status: "rejected", errorCode: "corrupted_file" },
    ]);
  });

  it("one invalid file in a batch of 3 does not fail the other 2", async () => {
    const good1 = buildPdf();
    const garbage = Buffer.from("not a supported format", "latin1");
    const good2 = buildJpeg();
    const results = await testDb.$transaction((tx) =>
      uploadDocumentsService(
        tx,
        dfx.storage,
        scanner,
        ocr,
        fx.authFor("providerUserStandalone"),
        dfx.standaloneCase.id,
        [file("good1.pdf", good1), file("bad.txt", garbage), file("good2.jpg", good2)],
        undefined
      )
    );
    expect(results[0].status).toBe("created");
    expect(results[1]).toMatchObject({ status: "rejected", errorCode: "unsupported_format" });
    expect(results[2].status).toBe("created");
  });

  it("exact-duplicate detection is scoped to the Case — same bytes flagged within a Case, not flagged in a different Case", async () => {
    const bytes = buildJpeg();
    const first = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("dup.jpg", bytes)], undefined)
    );
    expect(first[0].status).toBe("created");

    const second = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("dup-again.jpg", bytes)], undefined)
    );
    expect(second[0]).toMatchObject({ status: "duplicate", errorCode: "duplicate_file", existingDocumentId: first[0].documentId });

    // Same bytes, DIFFERENT Case (owned by a different Provider) — never flagged.
    const elsewhere = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.creatorOnlyCase.id, [file("dup-elsewhere.jpg", bytes)], undefined)
    );
    expect(elsewhere[0].status).toBe("created");
  });

  it("an omitted type produces needs_type_confirmation; confirm-type moves it to ready and audits document_type_confirmed, a second different confirm-type audits document_type_changed", async () => {
    const uploaded = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [file("needs-type.pdf", buildPdf())], undefined)
    );
    const documentId = uploaded[0].documentId!;
    const beforeConfirm = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(beforeConfirm.status).toBe("needs_type_confirmation");

    const confirmed = await testDb.$transaction((tx) =>
      confirmDocumentTypeService(tx, fx.authFor("providerUserConnected"), documentId, beforeConfirm.version, "invoice")
    );
    expect(confirmed.status).toBe("ready");
    expect(confirmed.documentTypeCode).toBe("invoice");

    const confirmedEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "Document", targetId: documentId, eventType: "document_type_confirmed" },
    });
    expect(confirmedEvent).not.toBeNull();

    const changed = await testDb.$transaction((tx) =>
      confirmDocumentTypeService(tx, fx.authFor("providerUserConnected"), documentId, confirmed.version, "medical_report")
    );
    expect(changed.documentTypeCode).toBe("medical_report");

    const changedEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "Document", targetId: documentId, eventType: "document_type_changed" },
    });
    expect(changedEvent).not.toBeNull();
  });

  it("replace creates a new version, moves currentVersionId, leaves the old version's fields untouched, and audits document_replaced", async () => {
    const uploaded = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("v1.pdf", buildPdf())], "invoice")
    );
    const documentId = uploaded[0].documentId!;
    const oldVersionId = uploaded[0].versionId!;
    const oldVersionBefore = await testDb.documentVersion.findUniqueOrThrow({ where: { id: oldVersionId } });
    const documentBefore = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });

    const replaced = await testDb.$transaction((tx) =>
      replaceDocumentVersionService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), documentId, documentBefore.version, {
        file: file("v2.pdf", buildPdf()),
        replacementReason: "clearer_copy",
      })
    );
    expect(replaced.currentVersionId).not.toBe(oldVersionId);
    expect(replaced.currentVersionId).toBeTruthy();

    const oldVersionAfter = await testDb.documentVersion.findUniqueOrThrow({ where: { id: oldVersionId } });
    expect(oldVersionAfter).toEqual(oldVersionBefore); // byte-for-byte unchanged

    const newVersion = await testDb.documentVersion.findUniqueOrThrow({ where: { id: replaced.currentVersionId! } });
    expect(newVersion.replacesVersionId).toBe(oldVersionId);
    expect(newVersion.replacementReason).toBe("clearer_copy");
    expect(newVersion.versionNumber).toBe(oldVersionBefore.versionNumber + 1);

    const replacedEvent = await testDb.auditEvent.findFirst({
      where: { targetType: "Document", targetId: documentId, eventType: "document_replaced" },
    });
    expect(replacedEvent).not.toBeNull();
  });

  it("hard-deletes a fresh zero-activity Document and removes its stored bytes; falls back to archive once real activity has occurred", async () => {
    const uploaded = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("fresh.pdf", buildPdf())], undefined)
    );
    const documentId = uploaded[0].documentId!;
    const sourceFile = await testDb.sourceFile.findFirstOrThrow({ where: { versions: { some: { documentId } } } });
    expect(await dfx.storage.exists(sourceFile.storageKey)).toBe(true);

    const result = await testDb.$transaction((tx) => deleteDocumentService(tx, dfx.storage, fx.authFor("providerUserStandalone"), documentId));
    expect(result.hardDeleted).toBe(true);
    expect(await testDb.document.findUnique({ where: { id: documentId } })).toBeNull();
    expect(await dfx.storage.exists(sourceFile.storageKey)).toBe(false);

    // A Document with real activity beyond creation (a replace) falls back to archive.
    const uploaded2 = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("active.pdf", buildPdf())], undefined)
    );
    const documentId2 = uploaded2[0].documentId!;
    const doc2Before = await testDb.document.findUniqueOrThrow({ where: { id: documentId2 } });
    await testDb.$transaction((tx) =>
      replaceDocumentVersionService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), documentId2, doc2Before.version, {
        file: file("active-v2.pdf", buildPdf()),
        replacementReason: "clearer_copy",
      })
    );

    const fallback = await testDb.$transaction((tx) => deleteDocumentService(tx, dfx.storage, fx.authFor("providerUserStandalone"), documentId2));
    expect(fallback.hardDeleted).toBe(false);
    const archived = await testDb.document.findUniqueOrThrow({ where: { id: documentId2 } });
    expect(archived.status).toBe("archived");
  });

  it("DocumentPageReference rows are created and correctly counted for a multi-page PDF", async () => {
    const uploaded = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("multi.pdf", buildPdf({ pages: 4 }))], undefined)
    );
    const versionId = uploaded[0].versionId!;
    const pageRefs = await testDb.documentPageReference.findMany({ where: { documentVersionId: versionId }, orderBy: { documentPageNumber: "asc" } });
    expect(pageRefs).toHaveLength(4);
    expect(pageRefs.map((p) => p.sourcePageNumber)).toEqual([1, 2, 3, 4]);
    expect(pageRefs.map((p) => p.documentPageNumber)).toEqual([1, 2, 3, 4]);
    expect(pageRefs.every((p) => p.included && p.rotation === 0)).toBe(true);
  });

  it("archiveDocumentService rejects a stale version and an already-archived Document", async () => {
    const uploaded = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserStandalone"), dfx.standaloneCase.id, [file("to-archive.pdf", buildPdf())], undefined)
    );
    const documentId = uploaded[0].documentId!;

    await expect(
      testDb.$transaction((tx) => archiveDocumentService(tx, fx.authFor("providerUserStandalone"), documentId, 999))
    ).rejects.toMatchObject({ code: "stale_version" });

    const archived = await testDb.$transaction((tx) => archiveDocumentService(tx, fx.authFor("providerUserStandalone"), documentId, 1));
    expect(archived.status).toBe("archived");

    await expect(
      testDb.$transaction((tx) => archiveDocumentService(tx, fx.authFor("providerUserStandalone"), documentId, archived.version))
    ).rejects.toMatchObject({ code: "invalid_state" });
  });
});
