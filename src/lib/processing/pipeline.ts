import { createRequire } from "node:module";
import type { Prisma } from "@/generated/prisma/client";
import { extractEmbeddedPageTexts } from "@/lib/processing/pdfText";
import { renderPdfPageToPng } from "@/lib/processing/renderPdfPage";
import type { OcrClient } from "@/lib/processing/ocrClient";
import { hashProcessingInput, withProcessingJob } from "@/lib/processing/job";
import { runDeterministicClassification } from "@/lib/processing/classification";
import { runDeterministicExtraction } from "@/lib/processing/extraction";

const require = createRequire(import.meta.url);
const PDFJS_VERSION: string = require("pdfjs-dist/package.json").version;

const EMBEDDED_TEXT_ENGINE = "embedded_pdf_text";
const TESSERACT_ENGINE = "tesseract";

/**
 * `OcrPageResult` is reused for embedded text too — spec §9 treats
 * "preserve page-level text" as one generic step; OCR is just the harder
 * case that needs real engine tracking. Also doubles as the cache: a
 * documentVersionId's rows already existing means "read_text" already ran.
 */
export async function ensureEmbeddedTextExtracted(
  tx: Prisma.TransactionClient,
  documentVersionId: string,
  buffer: Buffer,
  sourceFileContentHash: string
): Promise<string[]> {
  const existing = await tx.ocrPageResult.findMany({
    where: { documentVersionId },
    orderBy: { pageNumber: "asc" },
  });
  if (existing.length > 0) return existing.map((p) => p.text);

  let pageTexts: string[] = [];
  await withProcessingJob(
    tx,
    documentVersionId,
    "read_text",
    hashProcessingInput([sourceFileContentHash, "read_text"]),
    async () => {
      pageTexts = await extractEmbeddedPageTexts(buffer);
      await tx.ocrPageResult.createMany({
        data: pageTexts.map((text, i) => ({
          documentVersionId,
          pageNumber: i + 1,
          text,
          confidence: 1.0,
          ocrEngine: EMBEDDED_TEXT_ENGINE,
          ocrEngineVersion: PDFJS_VERSION,
        })),
      });
    }
  );
  return pageTexts;
}

/**
 * For every page still empty after embedded-text extraction, rasterize it
 * and try OCR — never touches a page that already has usable text (spec §9:
 * "do not OCR when embedded text is reliable"). Updates the *same*
 * `(documentVersionId, pageNumber)` row embedded-text already created,
 * rather than a separate row — one text result per page, sourced by
 * whichever method actually produced something.
 */
async function fillGapsWithOcr(
  tx: Prisma.TransactionClient,
  ocrClient: OcrClient,
  documentVersionId: string,
  buffer: Buffer,
  sourceFileContentHash: string,
  pageTexts: string[]
): Promise<string[]> {
  if (pageTexts.every((t) => t.trim())) return pageTexts;

  const merged = [...pageTexts];
  await withProcessingJob(tx, documentVersionId, "ocr", hashProcessingInput([sourceFileContentHash, "ocr"]), async () => {
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].trim()) continue;
      const pageNumber = i + 1;
      const png = await renderPdfPageToPng(buffer, pageNumber);
      if (!png) continue;
      const result = await ocrClient.recognize(png, "image/png");
      if (!result || !result.text.trim()) continue;

      await tx.ocrPageResult.update({
        where: { documentVersionId_pageNumber: { documentVersionId, pageNumber } },
        data: {
          text: result.text,
          confidence: result.confidence,
          blocks: result.blocks as unknown as Prisma.InputJsonValue,
          ocrEngine: TESSERACT_ENGINE,
          ocrEngineVersion: result.engineVersion,
        },
      });
      merged[i] = result.text;
    }
  });
  return merged;
}

/** No embedded-text step exists for a non-PDF upload — OCR runs directly on the raw bytes as page 1. */
async function ocrImageUpload(
  tx: Prisma.TransactionClient,
  ocrClient: OcrClient,
  documentVersionId: string,
  buffer: Buffer,
  mimeType: string,
  sourceFileContentHash: string
): Promise<string[]> {
  let text = "";
  await withProcessingJob(tx, documentVersionId, "ocr", hashProcessingInput([sourceFileContentHash, "ocr"]), async () => {
    const result = await ocrClient.recognize(buffer, mimeType);
    if (!result || !result.text.trim()) return;
    text = result.text;
    await tx.ocrPageResult.create({
      data: {
        documentVersionId,
        pageNumber: 1,
        text,
        confidence: result.confidence,
        blocks: result.blocks as unknown as Prisma.InputJsonValue,
        ocrEngine: TESSERACT_ENGINE,
        ocrEngineVersion: result.engineVersion,
      },
    });
  });
  return [text];
}

/** Best available text per page, regardless of which engine (embedded text or OCR) produced it. */
export async function ensurePageText(
  tx: Prisma.TransactionClient,
  ocrClient: OcrClient,
  params: { documentVersionId: string; buffer: Buffer; mimeType: string; sourceFileContentHash: string }
): Promise<string[]> {
  if (params.mimeType !== "application/pdf") {
    return ocrImageUpload(tx, ocrClient, params.documentVersionId, params.buffer, params.mimeType, params.sourceFileContentHash);
  }
  const embeddedTexts = await ensureEmbeddedTextExtracted(tx, params.documentVersionId, params.buffer, params.sourceFileContentHash);
  return fillGapsWithOcr(tx, ocrClient, params.documentVersionId, params.buffer, params.sourceFileContentHash, embeddedTexts);
}

export async function loadCachedPageTexts(tx: Prisma.TransactionClient, documentVersionId: string): Promise<string[]> {
  const rows = await tx.ocrPageResult.findMany({
    where: { documentVersionId },
    orderBy: { pageNumber: "asc" },
  });
  return rows.map((p) => p.text);
}

/**
 * Called from uploadDocumentsService/replaceDocumentVersionService, which
 * already hold the file buffer in memory — no storage round-trip needed.
 */
export async function processAfterUpload(
  tx: Prisma.TransactionClient,
  ocrClient: OcrClient,
  params: {
    documentVersionId: string;
    buffer: Buffer;
    mimeType: string;
    sourceFileContentHash: string;
    originalFilename: string;
    schemeVersionId: string | null;
    confirmedTypeCode: string | null;
    caseId: string;
    documentId: string;
  }
): Promise<void> {
  const pageTexts = await ensurePageText(tx, ocrClient, {
    documentVersionId: params.documentVersionId,
    buffer: params.buffer,
    mimeType: params.mimeType,
    sourceFileContentHash: params.sourceFileContentHash,
  });

  if (params.confirmedTypeCode && params.schemeVersionId) {
    await runDeterministicExtraction(tx, {
      caseId: params.caseId,
      documentId: params.documentId,
      documentVersionId: params.documentVersionId,
      schemeVersionId: params.schemeVersionId,
      confirmedTypeCode: params.confirmedTypeCode,
      sourceFileContentHash: params.sourceFileContentHash,
      pageTexts,
    });
  } else if (params.schemeVersionId) {
    await runDeterministicClassification(tx, {
      documentVersionId: params.documentVersionId,
      originalFilename: params.originalFilename,
      schemeVersionId: params.schemeVersionId,
      sourceFileContentHash: params.sourceFileContentHash,
      pageTexts,
    });
  }
}

/**
 * Called from confirmDocumentTypeService, which only has a documentId — no
 * buffer in hand. Reads the text cached at upload time; no new
 * StorageAdapter method needed.
 */
export async function processAfterTypeConfirmed(
  tx: Prisma.TransactionClient,
  params: {
    caseId: string;
    documentId: string;
    documentVersionId: string;
    schemeVersionId: string | null;
    confirmedTypeCode: string;
    sourceFileContentHash: string;
  }
): Promise<void> {
  if (!params.schemeVersionId) return;
  const pageTexts = await loadCachedPageTexts(tx, params.documentVersionId);
  await runDeterministicExtraction(tx, {
    caseId: params.caseId,
    documentId: params.documentId,
    documentVersionId: params.documentVersionId,
    schemeVersionId: params.schemeVersionId,
    confirmedTypeCode: params.confirmedTypeCode,
    sourceFileContentHash: params.sourceFileContentHash,
    pageTexts,
  });
}
