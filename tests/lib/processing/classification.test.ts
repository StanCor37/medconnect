import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../../setup/testDb";
import { buildFixtures, type Fixtures } from "../../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../../setup/documentFixtures";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { FakeOcrClient } from "../../setup/fakeOcrClient";
import { uploadDocumentsService, type UploadFileInput } from "@/lib/documents/service";
import { runDeterministicClassification } from "@/lib/processing/classification";

// Content must be unique per call, or checkForDuplicateDocumentInCase flags
// the 2nd+ upload as an exact-match duplicate and returns no versionId.
function jpeg(name: string): UploadFileInput {
  return {
    originalFilename: name,
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`unique:${uniqueSuffix()}-padding-bytes`)]),
  };
}

describe("processing/classification", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const scanner = new NoOpMalwareScanner();
  const ocr = new FakeOcrClient();

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);
    await testDb.documentTypeDefinition.update({
      where: { id: dfx.invoiceType.id },
      data: { classificationHints: { filenameKeywords: ["invoice", "faktura"], textKeywords: ["total amount", "invoice number"] } },
    });
    await testDb.documentTypeDefinition.update({
      where: { id: dfx.medicalReportType.id },
      data: { classificationHints: { filenameKeywords: ["report"] } },
    });
  });

  afterAll(async () => {
    await dfx.cleanup();
    await fx.cleanup();
  });

  async function newVersionId(): Promise<string> {
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [jpeg("scan.jpg")], undefined)
    );
    return result.versionId!;
  }

  it("a full text-keyword match auto-suggests the winning type via deterministic_text", async () => {
    const documentVersionId = await newVersionId();
    await testDb.$transaction((tx) =>
      runDeterministicClassification(tx, {
        documentVersionId,
        originalFilename: "scan.jpg",
        schemeVersionId: dfx.schemeVersion.id,
        sourceFileContentHash: `hash-${documentVersionId}`,
        pageTexts: ["This document has the total amount and the invoice number printed on it."],
      })
    );
    const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: documentVersionId } });
    expect(version.classificationStatus).toBe("suggested");
    const result = await testDb.documentClassificationResult.findFirstOrThrow({ where: { documentVersionId } });
    expect(result.suggestedTypeCode).toBe("invoice");
    expect(result.method).toBe("deterministic_text");
    expect(result.confidence).toBe(1);
  });

  it("text signal wins over filename when a type configures both, even at partial match", async () => {
    const documentVersionId = await newVersionId();
    await testDb.$transaction((tx) =>
      runDeterministicClassification(tx, {
        documentVersionId,
        originalFilename: "invoice-scan.jpg", // would match invoice's filenameKeywords
        schemeVersionId: dfx.schemeVersion.id,
        sourceFileContentHash: `hash-${documentVersionId}`,
        pageTexts: ["Only the invoice number appears here, nothing about totals."], // 1/2 textKeywords
      })
    );
    const result = await testDb.documentClassificationResult.findFirstOrThrow({ where: { documentVersionId } });
    // deterministic_text (0.5) still wins the "which method" choice for the
    // invoice type over what a filename-only score would have been (1.0) —
    // proving text is preferred once the type opts into text keywords at all.
    expect(result.method).toBe("deterministic_text");
    expect(result.confidence).toBe(0.5);
  });

  it("a below-threshold candidate lands in unclear, not suggested", async () => {
    const documentVersionId = await newVersionId();
    await testDb.$transaction((tx) =>
      runDeterministicClassification(tx, {
        documentVersionId,
        originalFilename: "scan.jpg",
        schemeVersionId: dfx.schemeVersion.id,
        sourceFileContentHash: `hash-${documentVersionId}`,
        pageTexts: ["Only the invoice number appears here, nothing about totals."],
      })
    );
    const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: documentVersionId } });
    expect(version.classificationStatus).toBe("unclear");
    const result = await testDb.documentClassificationResult.findFirstOrThrow({ where: { documentVersionId } });
    expect(result.suggestedTypeCode).toBeNull();
  });

  it("no configured signal matches at all — classificationStatus is left untouched (pending)", async () => {
    const documentVersionId = await newVersionId();
    await testDb.$transaction((tx) =>
      runDeterministicClassification(tx, {
        documentVersionId,
        originalFilename: "scan.jpg",
        schemeVersionId: dfx.schemeVersion.id,
        sourceFileContentHash: `hash-${documentVersionId}`,
        pageTexts: ["Nothing relevant in here at all."],
      })
    );
    const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: documentVersionId } });
    expect(version.classificationStatus).toBe("pending");
    const count = await testDb.documentClassificationResult.count({ where: { documentVersionId } });
    expect(count).toBe(0);
  });

  it("re-running with the same content hash is a cache hit — job stays completed, no duplicate result row", async () => {
    const documentVersionId = await newVersionId();
    const params = {
      documentVersionId,
      originalFilename: "scan.jpg",
      schemeVersionId: dfx.schemeVersion.id,
      sourceFileContentHash: `hash-${documentVersionId}`,
      pageTexts: ["This document has the total amount and the invoice number printed on it."],
    };
    await testDb.$transaction((tx) => runDeterministicClassification(tx, params));
    await testDb.$transaction((tx) => runDeterministicClassification(tx, params));
    const count = await testDb.documentClassificationResult.count({ where: { documentVersionId } });
    expect(count).toBe(1);
    const job = await testDb.documentProcessingJob.findFirstOrThrow({ where: { documentVersionId, task: "classify" } });
    expect(job.status).toBe("completed");
    expect(job.attempt).toBe(1);
  });
});
