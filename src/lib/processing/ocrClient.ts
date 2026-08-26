import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Explicit dependency, not an imported singleton — same pattern as
 * StorageAdapter (src/lib/storage/StorageAdapter.ts) and MalwareScanner
 * (src/lib/documents/malwareScanner.ts): lets tests substitute a fake
 * without shelling out to a real binary.
 *
 * History: a PaddleOCR-based Python microservice was tried first — it
 * required Python, a venv, and pip-installing paddlepaddle/paddleocr, and
 * even then hit a real incompatibility (a Windows CPU oneDNN/PIR bug, then a
 * numpy ABI mismatch after downgrading). `tesseract.js` (WASM, in-process)
 * replaced it — no Python, no separate service — but its WASM build is
 * markedly slower than native Tesseract and occasionally failed to produce
 * usable text where the native binary succeeds on the same image. This
 * client shells out to the real, native Tesseract binary instead: still no
 * Python, no persistent service, no network call — just a local CLI
 * invocation per page, using Leptonica's native (non-WASM) image decoding
 * and OpenMP-accelerated recognition.
 */
export interface OcrBlockResult {
  text: string;
  confidence: number;
  boundingBox: unknown;
  blockType: string;
}

export interface OcrResult {
  text: string;
  confidence: number;
  blocks: OcrBlockResult[];
  engineVersion: string;
}

export interface OcrClient {
  recognize(imageBuffer: Buffer, mimeType: string): Promise<OcrResult | null>;
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/heic": "heic", // best-effort — Leptonica has no HEIC decoder in the standard Windows build; degrades to null below.
};

// Windows' winget/installer package puts tesseract.exe here and does not
// reliably land it on PATH for already-running processes (a fresh shell
// picks up the machine PATH; a long-running `next dev` process does not).
// Linux/macOS deployments are expected to have `tesseract` on PATH already
// (e.g. `apt install tesseract-ocr` in the container image).
const WINDOWS_DEFAULT_INSTALL_PATH = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";

let resolvedBinary: string | null = null;
function resolveTesseractBinary(): string {
  if (resolvedBinary) return resolvedBinary;
  if (process.env.TESSERACT_PATH) {
    resolvedBinary = process.env.TESSERACT_PATH;
  } else if (process.platform === "win32" && existsSync(WINDOWS_DEFAULT_INSTALL_PATH)) {
    resolvedBinary = WINDOWS_DEFAULT_INSTALL_PATH;
  } else {
    resolvedBinary = "tesseract"; // rely on PATH
  }
  return resolvedBinary;
}

interface TsvWordRow {
  blockNum: number;
  parNum: number;
  lineNum: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
}

/**
 * Tesseract's `tsv` output format: one row per page/block/paragraph/line/word
 * (a `level` column distinguishes them). Only level 5 (word) rows carry real
 * text and a meaningful 0-100 confidence — everything else is a grouping
 * header with conf -1 and empty text, so those are filtered out here.
 */
function parseWordRows(tsv: string): TsvWordRow[] {
  const rows: TsvWordRow[] = [];
  for (const line of tsv.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 12 || cols[0] !== "5") continue;
    const [, , blockNum, parNum, lineNum, , left, top, width, height, conf, ...textParts] = cols;
    const text = textParts.join("\t").trim();
    if (!text) continue;
    rows.push({
      blockNum: Number(blockNum),
      parNum: Number(parNum),
      lineNum: Number(lineNum),
      left: Number(left),
      top: Number(top),
      width: Number(width),
      height: Number(height),
      conf: Number(conf),
      text,
    });
  }
  return rows;
}

/** Groups word rows into lines (matching the granularity the pipeline/UI previously got from tesseract.js's `blocks` output). */
function wordsToLines(words: TsvWordRow[]): OcrBlockResult[] {
  const lineGroups = new Map<string, TsvWordRow[]>();
  for (const word of words) {
    const key = `${word.blockNum}:${word.parNum}:${word.lineNum}`;
    const group = lineGroups.get(key);
    if (group) group.push(word);
    else lineGroups.set(key, [word]);
  }

  return Array.from(lineGroups.values()).map((lineWords) => {
    const left = Math.min(...lineWords.map((w) => w.left));
    const top = Math.min(...lineWords.map((w) => w.top));
    const x1 = Math.max(...lineWords.map((w) => w.left + w.width));
    const y1 = Math.max(...lineWords.map((w) => w.top + w.height));
    const avgConf = lineWords.reduce((sum, w) => sum + w.conf, 0) / lineWords.length;
    return {
      text: lineWords.map((w) => w.text).join(" "),
      confidence: avgConf / 100,
      boundingBox: { x0: left, y0: top, x1, y1 },
      blockType: "line",
    };
  });
}

let cachedVersion: string | null = null;
async function getEngineVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const { stderr, stdout } = await execFileAsync(resolveTesseractBinary(), ["--version"]);
    const match = /tesseract\s+(\S+)/i.exec(stdout || stderr);
    cachedVersion = match ? match[1] : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

/**
 * Never throws — a missing binary, decode failure, or recognition failure
 * degrades to `null` ("OCR unavailable for this call"), matching "manual
 * continuation must remain available when automation fails." A page that
 * genuinely has no text also comes back as a successful result with empty
 * `text`, which callers treat the same way (both mean "nothing to show").
 */
export class TesseractOcrClient implements OcrClient {
  async recognize(imageBuffer: Buffer, mimeType: string): Promise<OcrResult | null> {
    const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? "png";
    const tmpBase = path.join(os.tmpdir(), `medconnect-ocr-${crypto.randomUUID()}`);
    const inputPath = `${tmpBase}.${extension}`;
    const outputBase = `${tmpBase}-out`;
    try {
      await fs.writeFile(inputPath, imageBuffer);
      await execFileAsync(resolveTesseractBinary(), [inputPath, outputBase, "-l", "eng", "tsv"]);
      const tsv = await fs.readFile(`${outputBase}.tsv`, "utf8");
      const words = parseWordRows(tsv);
      if (words.length === 0) return null;

      const lines = wordsToLines(words);
      const text = lines.map((l) => l.text).join("\n").trim();
      if (!text) return null;

      return {
        text,
        confidence: words.reduce((sum, w) => sum + w.conf, 0) / words.length / 100,
        blocks: lines,
        engineVersion: `tesseract@${await getEngineVersion()}`,
      };
    } catch {
      return null;
    } finally {
      await fs.rm(inputPath, { force: true });
      await fs.rm(`${outputBase}.tsv`, { force: true });
    }
  }
}

let singleton: OcrClient | null = null;

export function getDefaultOcrClient(): OcrClient {
  singleton ??= new TesseractOcrClient();
  return singleton;
}
