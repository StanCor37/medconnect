/**
 * Hand-rolled, documented approximation — counts non-overlapping `/Type
 * /Page` object matches in the raw PDF bytes, falling back to a `/Count N`
 * scan on the root pages dictionary. Undercounts PDFs whose page objects
 * live entirely inside compressed object streams with no readable `/Count`
 * fallback either — acceptable this phase; `pdf-lib` is the correct real
 * answer if this becomes a genuine product concern later, not installed now
 * (same spirit as Segment 3's flat money-normalization simplification).
 */
export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");

  const pageMatches = text.match(/\/Type\s*\/Page(?![A-Za-z])/g);
  if (pageMatches && pageMatches.length > 0) {
    return pageMatches.length;
  }

  const pagesDictMatch = text.match(/\/Type\s*\/Pages[\s\S]{0,500}?\/Count\s+(\d+)/);
  if (pagesDictMatch) {
    const count = parseInt(pagesDictMatch[1], 10);
    if (Number.isFinite(count) && count > 0) return count;
  }

  return 1;
}
