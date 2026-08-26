// @ts-expect-error - pdfjs-dist ships no type declarations for this worker submodule specifically (only for the main pdf.mjs entry point).
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

/**
 * A hand-rolled regex/zlib extractor was tried first and tested against real
 * sample documents (a scanned-image insurance bundle and a vector-outlined
 * invoice) — it recovered zero usable text from either, including a page
 * that genuinely has a text layer (subset-font CID/Identity-H encoding needs
 * a real font ToUnicode CMap to decode, not a regex). `pdfjs-dist`'s legacy
 * (Node-compatible) build resolves that correctly — but getting its worker
 * wired up took three attempts, the first two of which passed every
 * automated test yet silently broke real uploads through the actual running
 * dev server, since the test suite runs via plain Node/tsx and never
 * touches Next's bundler at all:
 *
 * 1. `createRequire(...).resolve(...)` to find `pdf.worker.mjs`'s path, then
 *    assign it to `GlobalWorkerOptions.workerSrc` — Turbopack's static
 *    analysis flagged the whole package as "can't be external" over this
 *    `require()` of an ESM file and silently mis-handled it.
 * 2. `import.meta.resolve(...)` instead — not implemented in Turbopack's
 *    dev runtime at all (`TypeError: ...resolve is not a function`).
 * 3. Leaving `workerSrc` unset and relying on pdfjs-dist's own Node default
 *    (`GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"`, loaded via a
 *    *dynamic* `import()` from inside pdfjs-dist's own module) — no crash
 *    this time, but real uploads through the dev server still silently
 *    produced empty text; Turbopack was evidently still intercepting that
 *    internal dynamic import despite the external-package marking.
 *
 * The fix: pdfjs-dist's fake-worker loader checks
 * `globalThis.pdfjsWorker?.WorkerMessageHandler` *before* ever attempting
 * that dynamic import, and uses it directly if present. Importing the
 * worker's handler with a plain *static* import (which Turbopack traces and
 * bundles correctly, unlike a runtime string-based dynamic import) and
 * publishing it there sidesteps pdfjs-dist's own fragile fallback path
 * entirely — verified working both under plain Node/tsx and through a real
 * upload against the running dev server.
 */
(globalThis as unknown as { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = { WorkerMessageHandler };

const pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");

/** Shared by renderPdfPage.ts. */
export async function configuredPdfjsLib() {
  return pdfjsLibPromise;
}

/**
 * One entry per actual page, in document order (`pdf.numPages` is the
 * authoritative count straight from the parser). A page with nothing
 * extractable — scanned image, vector-outlined text, blank — comes back as
 * an empty string; there is no separate "unusable" heuristic because the
 * parser already tells the truth about what it found.
 */
export async function extractEmbeddedPageTexts(buffer: Buffer): Promise<string[]> {
  const pdfjsLib = await configuredPdfjsLib();
  try {
    // No standardFontDataUrl — same Turbopack-safe reasoning as the worker
    // above (avoids needing any path-resolution API). Non-fatal to omit:
    // pdfjs logs a "standard font data" warning for non-embedded standard
    // fonts and falls back to built-in metrics; text extraction still works.
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      pageTexts.push(text);
    }
    await loadingTask.destroy();
    return pageTexts;
  } catch {
    // Corrupted/unparseable beyond what checkPdfReadability already gates —
    // same effect as "no usable text" for every downstream caller.
    return [""];
  }
}

/** "No usable text at all" — every page came back empty/whitespace-only. */
export function isAnyPageTextUsable(pageTexts: string[]): boolean {
  return pageTexts.some((t) => t.trim().length > 0);
}
