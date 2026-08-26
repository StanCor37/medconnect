import { createCanvas } from "@napi-rs/canvas";

/** A plain white PNG with the given lines drawn as real black text — a "scan" with no embedded text layer, only pixels. */
export function buildTestImage(lines: string[]): Buffer {
  const width = 640;
  const height = 80 + lines.length * 50;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "black";
  ctx.font = "32px sans-serif";
  lines.forEach((line, i) => ctx.fillText(line, 20, 50 + i * 50));
  return canvas.toBuffer("image/png");
}

export function buildBlankImage(): Buffer {
  const canvas = createCanvas(200, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 200, 100);
  return canvas.toBuffer("image/png");
}
