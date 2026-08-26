import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * Emits a genuinely valid, minimal PDF-1.4 file (correct xref table + byte
 * offsets) using the standard base-14 Helvetica font — no embedding, no
 * subsetting, plain WinAnsi `(text) Tj` per line. Unlike the fake PDFs used
 * elsewhere in the test suite (Catalog/Pages/Page objects only, no content
 * stream, no xref — good enough for countPdfPages/checkPdfReadability's own
 * byte-level heuristics), `pdfjs-dist` is a real parser and needs a
 * genuinely valid file to extract anything from it.
 */
function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildTestPdf(pages: string[][]): Buffer {
  const objects: string[] = [];

  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontObjNum = 3;
  const firstPageObjNum = 4;

  const pageObjNums = pages.map((_, i) => firstPageObjNum + i * 2);
  const contentObjNums = pages.map((_, i) => firstPageObjNum + i * 2 + 1);

  objects[catalogObjNum] = `<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`;
  objects[pagesObjNum] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((lines, i) => {
    const pageObjNum = pageObjNums[i];
    const contentObjNum = contentObjNums[i];

    objects[pageObjNum] =
      `<< /Type /Page /Parent ${pagesObjNum} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> ` +
      `/MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>`;

    const ops = ["BT", "/F1 12 Tf", "72 720 Td"];
    lines.forEach((line, li) => {
      if (li > 0) ops.push("0 -14 Td");
      ops.push(`(${escapePdfString(line)}) Tj`);
    });
    ops.push("ET");
    const content = ops.join("\n");
    objects[contentObjNum] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  const totalObjects = objects.length; // sparse array — index 0 unused
  let body = "%PDF-1.4\n";
  const offsets: number[] = new Array(totalObjects).fill(0);

  for (let n = 1; n < totalObjects; n++) {
    offsets[n] = Buffer.byteLength(body, "latin1");
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${totalObjects}\n`;
  xref += `0000000000 65535 f \n`;
  for (let n = 1; n < totalObjects; n++) {
    xref += `${offsets[n].toString().padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${totalObjects} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body, "latin1");
}

/**
 * A PDF with genuinely no text layer at all — each page is a raw
 * `/DeviceRGB` image XObject (decoded from the given PNGs), no `Tj`/`TJ`
 * operators anywhere. This is what a real scanned document looks like to
 * `extractEmbeddedPageTexts` (nothing to extract), exercising the OCR
 * fallback path the way the deterministic text step alone cannot.
 */
export async function buildImageOnlyPdf(pageImages: Buffer[]): Promise<Buffer> {
  const pages = await Promise.all(
    pageImages.map(async (png) => {
      const img = await loadImage(png);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const rgb = Buffer.alloc(img.width * img.height * 3);
      for (let src = 0, dst = 0; src < imageData.data.length; src += 4, dst += 3) {
        rgb[dst] = imageData.data[src];
        rgb[dst + 1] = imageData.data[src + 1];
        rgb[dst + 2] = imageData.data[src + 2];
      }
      return { width: img.width, height: img.height, rgb };
    })
  );

  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const firstPageObjNum = 3;
  const pageObjNums = pages.map((_, i) => firstPageObjNum + i * 3);
  const imageObjNums = pages.map((_, i) => firstPageObjNum + i * 3 + 1);
  const contentObjNums = pages.map((_, i) => firstPageObjNum + i * 3 + 2);
  const totalObjects = firstPageObjNum + pages.length * 3;

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = new Array(totalObjects).fill(0);
  let offset = parts[0].length;

  function pushText(objNum: number, text: string) {
    const buf = Buffer.from(text, "latin1");
    offsets[objNum] = offset;
    parts.push(buf);
    offset += buf.length;
  }

  pushText(catalogObjNum, `${catalogObjNum} 0 obj\n<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\nendobj\n`);
  pushText(
    pagesObjNum,
    `${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`
  );

  pages.forEach((page, i) => {
    const pageObjNum = pageObjNums[i];
    const imageObjNum = imageObjNums[i];
    const contentObjNum = contentObjNums[i];

    pushText(
      pageObjNum,
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent ${pagesObjNum} 0 R /Resources << /XObject << /Im0 ${imageObjNum} 0 R >> >> ` +
        `/MediaBox [0 0 ${page.width} ${page.height}] /Contents ${contentObjNum} 0 R >>\nendobj\n`
    );

    offsets[imageObjNum] = offset;
    const imageHeader = Buffer.from(
      `${imageObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${page.rgb.length} >>\nstream\n`,
      "latin1"
    );
    const imageFooter = Buffer.from("\nendstream\nendobj\n", "latin1");
    parts.push(imageHeader, page.rgb, imageFooter);
    offset += imageHeader.length + page.rgb.length + imageFooter.length;

    const content = `q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`;
    pushText(
      contentObjNum,
      `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj\n`
    );
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (let n = 1; n < totalObjects; n++) {
    xref += `${offsets[n].toString().padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${totalObjects} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(Buffer.from(xref + trailer, "latin1"));

  return Buffer.concat(parts);
}
