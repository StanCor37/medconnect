import { describe, it, expect } from "vitest";
import { sniffMimeType } from "@/lib/documents/fileSignature";
import { countPdfPages } from "@/lib/documents/pdfPageCount";

describe("sniffMimeType", () => {
  it("recognizes a PDF by its %PDF- header", () => {
    const buf = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
    expect(sniffMimeType(buf)).toBe("application/pdf");
  });

  it("recognizes a JPEG by its FF D8 FF signature", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffMimeType(buf)).toBe("image/jpeg");
  });

  it("recognizes a PNG by its 8-byte signature", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffMimeType(buf)).toBe("image/png");
  });

  it("recognizes a WebP by its RIFF....WEBP container", () => {
    const buf = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "latin1")]);
    expect(sniffMimeType(buf)).toBe("image/webp");
  });

  it("recognizes little-endian and big-endian TIFF", () => {
    const little = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
    const big = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffMimeType(little)).toBe("image/tiff");
    expect(sniffMimeType(big)).toBe("image/tiff");
  });

  it("recognizes HEIC by its ISO-BMFF ftyp box with a heic brand", () => {
    const buf = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftyp", "latin1"), Buffer.from("heic", "latin1")]);
    expect(sniffMimeType(buf)).toBe("image/heic");
  });

  it("returns null for content matching none of the 6 signatures, regardless of a claimed extension", () => {
    const buf = Buffer.from("this is just plain text pretending to be a document", "latin1");
    expect(sniffMimeType(buf)).toBeNull();
  });

  it("returns null for a too-short buffer", () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe("countPdfPages — documented approximation", () => {
  it("counts /Type /Page object matches, excluding /Type /Pages", () => {
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R >> endobj
5 0 obj << /Type /Page /Parent 2 0 R >> endobj
%%EOF`,
      "latin1"
    );
    expect(countPdfPages(pdf)).toBe(3);
  });

  it("falls back to the /Count on the root Pages dictionary when no /Type /Page objects are readable", () => {
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 5 >> endobj
%%EOF`,
      "latin1"
    );
    expect(countPdfPages(pdf)).toBe(5);
  });

  it("documented limitation: defaults to 1 when page objects live entirely in a compressed object stream with no readable /Count either", () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /ObjStm /N 5 /First 20 >> stream\n...binary...\nendstream endobj\n%%EOF", "latin1");
    expect(countPdfPages(pdf)).toBe(1);
  });
});
