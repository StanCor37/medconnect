import { describe, it, expect } from "vitest";
import { buildTestPdf } from "../../setup/buildTestPdf";
import { extractEmbeddedPageTexts, isAnyPageTextUsable } from "@/lib/processing/pdfText";

describe("processing/pdfText", () => {
  it("extracts real text per page, in order, from a genuinely valid PDF", async () => {
    const pdf = buildTestPdf([
      ["Patient: Jane Doe", "Diagnosis: Sprained ankle"],
      ["Page two content"],
    ]);
    const texts = await extractEmbeddedPageTexts(pdf);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Patient: Jane Doe");
    expect(texts[0]).toContain("Diagnosis: Sprained ankle");
    expect(texts[1]).toContain("Page two content");
    expect(isAnyPageTextUsable(texts)).toBe(true);
  });

  it("a blank page comes back as an empty string, not an error, alongside a real one", async () => {
    const pdf = buildTestPdf([["Some real content here"], []]);
    const texts = await extractEmbeddedPageTexts(pdf);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Some real content here");
    expect(texts[1]).toBe("");
  });

  it("a corrupted/unparseable buffer degrades to no usable text rather than throwing", async () => {
    const texts = await extractEmbeddedPageTexts(Buffer.from("not a pdf at all"));
    expect(isAnyPageTextUsable(texts)).toBe(false);
  });

  it("isAnyPageTextUsable is false when every page is empty/whitespace", () => {
    expect(isAnyPageTextUsable(["", "   ", "\n"])).toBe(false);
    expect(isAnyPageTextUsable(["", "real text"])).toBe(true);
  });
});
