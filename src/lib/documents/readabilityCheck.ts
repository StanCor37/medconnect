/**
 * Deterministic-only, pre-storage REJECTION — not a stored state. Spec §6's
 * "reject... unreadable password-protected files, corrupted files" is read
 * literally as a gate before storage, distinct from §8's
 * partially_readable/unreadable states which describe quality problems
 * (blur, darkness, cropping) discovered by rendering/vision assessment —
 * infrastructure this phase doesn't have (Segment 6's job). A file that
 * fails neither check here is always persisted with `readabilityStatus:
 * "readable"` this phase.
 */
export type PdfReadabilityRejection = "password_protected" | "corrupted_file";

export function checkPdfReadability(buffer: Buffer): PdfReadabilityRejection | null {
  const head = buffer.subarray(0, 1024).toString("latin1");
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString("latin1");

  if (!head.includes("%PDF-") || !tail.includes("%%EOF")) {
    return "corrupted_file";
  }

  // Heuristic: an /Encrypt entry in the trailer dictionary marks the PDF as
  // encrypted/password-protected. Scanning the whole file for "/Encrypt" is
  // a documented simplification — a real PDF parser would only look at the
  // trailer dictionary, but this is sufficient for this phase's gate.
  const full = buffer.toString("latin1");
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(full)) {
    return "password_protected";
  }

  return null;
}
