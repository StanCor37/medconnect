import { createCanvas } from "@napi-rs/canvas";
import { configuredPdfjsLib } from "@/lib/processing/pdfText";

/**
 * Rasterizes one PDF page to a PNG buffer for OCR — only called for pages
 * that came back with no embedded text (spec §9: "do not OCR when embedded
 * text is reliable"). `scale: 2.0` (vs. the 1.0 "screen" default) trades a
 * larger image for materially better OCR accuracy on small print. Returns
 * `null` on any failure — same graceful-degradation contract as
 * extractEmbeddedPageTexts, callers treat it identically to "no usable text."
 */
export async function renderPdfPageToPng(buffer: Buffer, pageNumber: number): Promise<Buffer | null> {
  try {
    const pdfjsLib = await configuredPdfjsLib();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");
    // @ts-expect-error - @napi-rs/canvas's context is structurally compatible with pdfjs-dist's expected CanvasRenderingContext2D, but not the same declared type.
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    await loadingTask.destroy();

    return canvas.toBuffer("image/png");
  } catch {
    return null;
  }
}
