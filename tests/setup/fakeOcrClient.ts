import type { OcrClient, OcrResult } from "@/lib/processing/ocrClient";

/**
 * Same role NoOpMalwareScanner plays for malware scanning — a real
 * dependency the service layer takes explicitly, swapped for a fake in
 * tests so nothing shells out to the real (slower) Tesseract binary. Default
 * behavior (no canned responses queued) is "OCR found nothing," matching
 * the pre-OCR behavior — existing "no usable text" assertions don't change.
 */
export class FakeOcrClient implements OcrClient {
  public readonly calls: { imageBuffer: Buffer; mimeType: string }[] = [];
  private readonly queue: (OcrResult | null)[];

  constructor(queue: (OcrResult | null)[] = []) {
    this.queue = queue;
  }

  async recognize(imageBuffer: Buffer, mimeType: string): Promise<OcrResult | null> {
    this.calls.push({ imageBuffer, mimeType });
    if (this.queue.length === 0) return null;
    return this.queue.shift()!;
  }
}

export function fakeOcrResult(text: string, confidence = 0.9): OcrResult {
  return { text, confidence, blocks: [{ text, confidence, boundingBox: [], blockType: "line" }], engineVersion: "tesseract-fake" };
}
