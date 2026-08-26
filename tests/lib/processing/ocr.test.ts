import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../../setup/testDb";
import { buildFixtures, type Fixtures } from "../../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../../setup/documentFixtures";
import { buildTestPdf, buildImageOnlyPdf } from "../../setup/buildTestPdf";
import { buildTestImage, buildBlankImage } from "../../setup/buildTestImage";
import { FakeOcrClient, fakeOcrResult } from "../../setup/fakeOcrClient";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { uploadDocumentsService, type UploadFileInput } from "@/lib/documents/service";
import { TesseractOcrClient } from "@/lib/processing/ocrClient";
import { renderPdfPageToPng } from "@/lib/processing/renderPdfPage";
import { extractEmbeddedPageTexts } from "@/lib/processing/pdfText";
import { ensurePageText } from "@/lib/processing/pipeline";

// The real client — these tests prove OCR actually recognizes text, not
// just that the pipeline calls some client. Each call shells out to the
// native tesseract binary (no persistent worker/process to clean up
// afterwards, unlike the old tesseract.js WASM worker).
const realOcr = new TesseractOcrClient();

describe("processing/ocr — TesseractOcrClient itself", () => {
  it(
    "recognizes real text drawn onto an image",
    async () => {
      const image = buildTestImage(["Patient: Jane Doe", "Diagnosis: Sprained ankle"]);
      const result = await realOcr.recognize(image, "image/png");
      expect(result).not.toBeNull();
      expect(result!.text.toLowerCase()).toContain("patient");
      expect(result!.text.toLowerCase()).toContain("jane");
      expect(result!.confidence).toBeGreaterThan(0.5);
      expect(result!.blocks.length).toBeGreaterThan(0);
    },
    60000
  );

  it(
    "a blank image returns null — no text found, not an error",
    async () => {
      const result = await realOcr.recognize(buildBlankImage(), "image/png");
      expect(result).toBeNull();
    },
    30000
  );

  it(
    "a PDF page with a real text layer has nothing for extractEmbeddedPageTexts to hand to OCR, and rendering it still produces a readable image",
    async () => {
      const pdf = buildTestPdf([["Total: 90.00 EUR"]]);
      const embedded = await extractEmbeddedPageTexts(pdf);
      expect(embedded[0]).toContain("Total: 90.00 EUR"); // embedded text already found it — OCR would never even run here

      // Rendering doesn't care whether the page had embedded text — proves
      // the rasterization step itself produces something OCR can read.
      const rendered = await renderPdfPageToPng(pdf, 1);
      expect(rendered).not.toBeNull();
      const result = await realOcr.recognize(rendered!, "image/png");
      expect(result?.text.toLowerCase()).toContain("total");
    },
    30000
  );

  it(
    "a genuinely image-only PDF page (no text layer at all) is recovered end-to-end via render + OCR",
    async () => {
      const png = buildTestImage(["Examination Date: 12.08.2026"]);
      const pdf = await buildImageOnlyPdf([png]);

      const embedded = await extractEmbeddedPageTexts(pdf);
      expect(embedded[0]).toBe(""); // genuinely nothing to extract — this is what a real scan looks like

      const rendered = await renderPdfPageToPng(pdf, 1);
      expect(rendered).not.toBeNull();
      const result = await realOcr.recognize(rendered!, "image/png");
      expect(result?.text.toLowerCase()).toContain("examination");
    },
    30000
  );
});

function jpeg(name: string, buffer: Buffer): UploadFileInput {
  return { originalFilename: name, buffer };
}

describe("processing/ocr — pipeline wiring", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const scanner = new NoOpMalwareScanner();

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);
  });

  afterAll(async () => {
    await dfx.cleanup();
    await fx.cleanup();
  });

  it(
    "a non-PDF image upload with real text is OCR'd and the result is cached and classifiable",
    async () => {
      await testDb.documentTypeDefinition.update({
        where: { id: dfx.invoiceType.id },
        data: { classificationHints: { textKeywords: ["invoice number", "total amount"] } },
      });
      const image = buildTestImage(["This is an invoice.", "Total amount and invoice number included."]);
      const [result] = await testDb.$transaction((tx) =>
        uploadDocumentsService(tx, dfx.storage, scanner, realOcr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [jpeg("scan.jpg", image)], undefined)
      );
      const versionId = result.versionId!;

      const cached = await testDb.ocrPageResult.findFirstOrThrow({ where: { documentVersionId: versionId } });
      expect(cached.ocrEngine).toBe("tesseract");
      expect(cached.text.toLowerCase()).toContain("invoice");

      const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
      expect(version.classificationStatus).toBe("suggested");
    },
    60000
  );

  it("a page that already has embedded text never invokes the OCR client at all", async () => {
    const spy = new FakeOcrClient();
    const pdf = buildTestPdf([[`unique:${uniqueSuffix()}`, "Some real embedded text right here."]]);
    await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, spy, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [{ originalFilename: "text.pdf", buffer: pdf }], undefined)
    );
    expect(spy.calls).toHaveLength(0);
  });

  it("a second call with the same content hash is a cache hit — the OCR client is not invoked again", async () => {
    const spy = new FakeOcrClient([fakeOcrResult("Recognized text")]);
    const pdf = await buildImageOnlyPdf([buildTestImage([`unique:${uniqueSuffix()}`])]);
    const [uploaded] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, new NoOpMalwareScanner(), new FakeOcrClient(), fx.authFor("providerUserConnected"), dfx.connectedCase.id, [{ originalFilename: "scan.pdf", buffer: pdf }], undefined)
    );
    const versionId = uploaded.versionId!;
    const contentHash = "shared-hash-for-cache-test";

    const first = await testDb.$transaction((tx) =>
      ensurePageText(tx, spy, { documentVersionId: versionId, buffer: pdf, mimeType: "application/pdf", sourceFileContentHash: contentHash })
    );
    expect(spy.calls).toHaveLength(1);
    expect(first[0]).toBe("Recognized text");

    const second = await testDb.$transaction((tx) =>
      ensurePageText(tx, spy, { documentVersionId: versionId, buffer: pdf, mimeType: "application/pdf", sourceFileContentHash: contentHash })
    );
    expect(spy.calls).toHaveLength(1); // still 1 — cache hit, client not called again
    expect(second[0]).toBe("Recognized text");

    const job = await testDb.documentProcessingJob.findFirstOrThrow({ where: { documentVersionId: versionId, task: "ocr" } });
    expect(job.status).toBe("completed");
    expect(job.attempt).toBe(1);
  });

  it("a null OCR result (unavailable/found nothing) leaves the page with no cached text — same as before OCR existed", async () => {
    const spy = new FakeOcrClient(); // no queued responses -> always null
    const pdf = await buildImageOnlyPdf([buildBlankImage()]);
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, spy, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [{ originalFilename: "blank.pdf", buffer: pdf }], undefined)
    );
    const versionId = result.versionId!;
    expect(spy.calls).toHaveLength(1);

    // The embedded-text step still creates its (empty) placeholder row —
    // a failed/unavailable OCR attempt simply never overwrites it.
    const cached = await testDb.ocrPageResult.findFirstOrThrow({ where: { documentVersionId: versionId } });
    expect(cached.text).toBe("");
    expect(cached.ocrEngine).toBe("embedded_pdf_text");
    const version = await testDb.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.classificationStatus).toBe("pending");
  });
});
