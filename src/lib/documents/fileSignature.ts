/**
 * Hand-rolled magic-byte sniffing for the 6 fixed formats spec §6 supports —
 * a small, closed-set, fully-auditable check, matching this codebase's
 * existing preference for hand-rolled deterministic logic over a dependency
 * for something this narrow (see the deterministic rule evaluator, the flat
 * money-normalization simplification). Content bytes always win over a
 * client-declared Content-Type or filename extension.
 */
export type SupportedMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/heic"
  | "image/webp"
  | "image/tiff";

const HEIC_BRANDS = ["heic", "heix", "mif1", "hevc", "heim", "heis", "hevm", "hevs"];

export function sniffMimeType(buffer: Buffer): SupportedMime | null {
  if (buffer.length < 12) return null;

  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  const tiffMagic = buffer.subarray(0, 4);
  if (
    (tiffMagic[0] === 0x49 && tiffMagic[1] === 0x49 && tiffMagic[2] === 0x2a && tiffMagic[3] === 0x00) ||
    (tiffMagic[0] === 0x4d && tiffMagic[1] === 0x4d && tiffMagic[2] === 0x00 && tiffMagic[3] === 0x2a)
  ) {
    return "image/tiff";
  }

  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const majorBrand = buffer.subarray(8, 12).toString("latin1").trim().toLowerCase();
    if (HEIC_BRANDS.includes(majorBrand)) {
      return "image/heic";
    }
  }

  return null;
}
