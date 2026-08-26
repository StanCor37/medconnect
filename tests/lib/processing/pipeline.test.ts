import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../../setup/testDb";
import { buildFixtures, type Fixtures } from "../../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../../setup/documentFixtures";
import { buildTestPdf } from "../../setup/buildTestPdf";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { FakeOcrClient } from "../../setup/fakeOcrClient";
import { uploadDocumentsService, confirmDocumentTypeService, type UploadFileInput } from "@/lib/documents/service";

// A trailing unique line guarantees distinct file bytes per call, or
// checkForDuplicateDocumentInCase flags the 2nd+ upload as an exact-match
// duplicate and returns no versionId.
function pdfFile(name: string, lines: string[]): UploadFileInput {
  return { originalFilename: name, buffer: buildTestPdf([[...lines, `unique:${uniqueSuffix()}`]]) };
}
function jpeg(name: string): UploadFileInput {
  return {
    originalFilename: name,
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`unique:${uniqueSuffix()}-padding-bytes`)]),
  };
}

const INVOICE_TEXT = ["Patient: Jane Doe", "Examination Date: 12.08.2026", "Total: 90.00 EUR", "This is an invoice, total amount and invoice number included."];

describe("processing/pipeline wiring (uploadDocumentsService/confirmDocumentTypeService)", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const scanner = new NoOpMalwareScanner();
  const ocr = new FakeOcrClient();

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);
    await testDb.documentTypeDefinition.update({
      where: { id: dfx.invoiceType.id },
      data: { classificationHints: { textKeywords: ["total amount", "invoice number"] } },
    });
    await testDb.extractionFieldDefinition.create({
      data: {
        documentTypeId: dfx.invoiceType.id,
        code: "examination_date",
        label: "Examination Date",
        valueType: "date",
        required: true,
        extractionHints: ["Examination Date:\\s*([0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{4})"],
      },
    });
  });

  afterAll(async () => {
    await testDb.extractedField.deleteMany({ where: { fieldDefinition: { documentTypeId: dfx.invoiceType.id } } });
    await testDb.extractionFieldDefinition.deleteMany({ where: { documentTypeId: dfx.invoiceType.id } });
    await dfx.cleanup();
    await fx.cleanup();
  });

  it("an unclassified upload gets a real classification suggestion and caches its embedded text", async () => {
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [pdfFile("scan.pdf", INVOICE_TEXT)], undefined)
    );
    const versionId = result.versionId!;

    const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.classificationStatus).toBe("suggested");

    const classification = await testDb.documentClassificationResult.findFirstOrThrow({ where: { documentVersionId: versionId } });
    expect(classification.suggestedTypeCode).toBe("invoice");

    const cachedPages = await testDb.ocrPageResult.findMany({ where: { documentVersionId: versionId } });
    expect(cachedPages).toHaveLength(1);
    expect(cachedPages[0].ocrEngine).toBe("embedded_pdf_text");
    expect(cachedPages[0].text).toContain("Examination Date: 12.08.2026");

    // No extraction yet — the type isn't confirmed.
    const extractedCount = await testDb.extractedField.count({ where: { documentVersionId: versionId } });
    expect(extractedCount).toBe(0);

    // Confirming reuses the cached text (no re-parsing) and runs extraction.
    await testDb.$transaction((tx) => confirmDocumentTypeService(tx, fx.authFor("providerUserConnected"), result.documentId!, 1, "invoice"));
    const extracted = await testDb.extractedField.findFirstOrThrow({ where: { documentVersionId: versionId } });
    expect(extracted.status).toBe("extracted");
    expect(extracted.normalizedValue).toBe("2026-08-12");

    // Re-confirming the same type again is a cache hit — no duplicate row, job stays completed at attempt 1.
    await testDb.$transaction((tx) => confirmDocumentTypeService(tx, fx.authFor("providerUserConnected"), result.documentId!, 2, "invoice"));
    const count = await testDb.extractedField.count({ where: { documentVersionId: versionId } });
    expect(count).toBe(1);
    const job = await testDb.documentProcessingJob.findFirstOrThrow({ where: { documentVersionId: versionId, task: "extract" } });
    expect(job.attempt).toBe(1);
  });

  it("a Provider-selected type at upload skips classification and runs extraction immediately", async () => {
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [pdfFile("known.pdf", INVOICE_TEXT)], "invoice")
    );
    const versionId = result.versionId!;

    const classificationCount = await testDb.documentClassificationResult.count({ where: { documentVersionId: versionId } });
    expect(classificationCount).toBe(0);

    const extracted = await testDb.extractedField.findFirstOrThrow({ where: { documentVersionId: versionId } });
    expect(extracted.normalizedValue).toBe("2026-08-12");
  });

  it("a non-PDF upload never invokes the text parser and leaves classification pending", async () => {
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [jpeg("photo.jpg")], undefined)
    );
    const versionId = result.versionId!;

    const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.classificationStatus).toBe("pending");

    const cachedPages = await testDb.ocrPageResult.count({ where: { documentVersionId: versionId } });
    expect(cachedPages).toBe(0);
    const job = await testDb.documentProcessingJob.count({ where: { documentVersionId: versionId, task: "read_text" } });
    expect(job).toBe(0);
  });
});
